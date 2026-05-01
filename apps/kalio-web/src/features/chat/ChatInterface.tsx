import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { Copy, Check } from 'lucide-react';
import { ConversationFilesBar } from '../vfs/ConversationFilesBar';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { useSettingsStore } from '../settings/settingsStore';
import { eventBus } from '../../services/eventBus';
import { MessageBubble } from './MessageBubble';
import { AgentTurnBubble } from './AgentTurnBubble';
import { ChatInput } from './ChatInput';
import { TokenBadge } from './TokenBadge';
import { ContextStats } from './ContextStats';
import { useContextUsage } from './hooks/useContextUsage';
import { computeAnsweredCallIds, buildTurnsFromHistory } from './chatUtils';
import { apiClient } from '../../services/apiClient';
import type { ChatMessage, Persona } from '@kalio/types';

export { computeAnsweredCallIds } from './chatUtils';

export function ChatInterface() {
  const {
    messages, activeSessionId, sessions, addMessage, appendChunk, finalizeChunk, setMessages,
    agentTurns, startAgentTurn, addTurnItem, finalizeAgentTurn,
    setAgentTurns, markAgentTurnError, removeLastAgentTurn, flushThinkingChunks,
  } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const activeModel = useSettingsStore((s) => s.getEffectiveModel());
  const {
    isStreaming,
    toolActivities,
    systemPrompt,
    activeToolNames,
    setStreaming,
    setPendingConfirmation,
    addToolActivity,
    updateToolActivity,
    clearToolActivities,
    addLlmActivity,
    updateLlmActivity,
    setContext,
    registerCallId,
    addActiveAgentLoop,
    removeActiveAgentLoop,
    appendCLIAgentChunk,
    clearCLIAgentOutput,
  } = useAgentStore();
  const [error, setError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const lastSentContentRef = useRef<string>('');
  const [personas, setPersonas] = useState<Persona[]>([]);
  const { updateSession } = useSessionStore();

  useEffect(() => {
    apiClient
      .get<Persona[]>('/api/personas')
      .then((r) => setPersonas(r.data))
      .catch((err: unknown) => console.error('[ChatInterface] personas load failed', err));
  }, []);

  const handlePersonaChange = async (personaId: string) => {
    if (!activeSessionId) return;
    try {
      await apiClient.patch(`/api/sessions/${activeSessionId}`, { personaId });
      updateSession(activeSessionId, { personaId });
    } catch (err: unknown) {
      console.error('[ChatInterface] persona change failed', err instanceof Error ? err : new Error(String(err)));
    }
  };
  const [showContextStats, setShowContextStats] = useState(false);
  const [vfsRefreshSignal, setVfsRefreshSignal] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Compute answered RA-App call IDs (user message appeared after the tool_result)
  const answeredCallIds = computeAnsweredCallIds(messages);

  // Context usage monitoring
  const { tokenCount, needsCompact, compactMessages } = useContextUsage();

  useEffect(() => {
    if (!eventBus.connected) eventBus.connect();

    const offChunk = eventBus.onChunk((chunk) => {
      if (!chunk.done) {
        appendChunk(chunk.messageId, chunk.delta, chunk.thinking, chunk.sessionId);

        // Only manage turn items for the currently active session
        if (chunk.sessionId === useSessionStore.getState().activeSessionId) {
          // Add to active turn for unified rendering
          // Read activeTurnId from store (not closure) to avoid stale reference
          const { activeTurnId: currentTurnId, agentTurns, addTurnItem } = useSessionStore.getState();
          if (currentTurnId) {
            const turn = agentTurns.find((t) => t.id === currentTurnId);
            if (turn) {
              const hasItem = turn.items.some(
                (item) => item.kind === (chunk.thinking ? 'thinking' : 'text') && item.messageId === chunk.messageId
              );
              if (!hasItem) {
                addTurnItem({ kind: chunk.thinking ? 'thinking' : 'text', messageId: chunk.messageId });
              }
            }
          }
        }
      } else {
        finalizeChunk(chunk.messageId);
        // Only update UI state for the active session
        if (chunk.sessionId === useSessionStore.getState().activeSessionId) {
          setStreaming(false);
          // After first assistant reply, generate a real title via LLM
          const { sessions, activeSessionId: sid } = useSessionStore.getState();
          const session = sessions.find((s) => s.id === sid);
          if (sid && session && (session.title === 'New Chat' || session.title === '')) {
            addLlmActivity({ id: 'title-gen', label: 'Generating title…', status: 'running', startedAt: Date.now() });
            fetch(`/api/sessions/${sid}/generate-title`, { method: 'POST' })
              .then((r) => r.json())
              .then((data: { title: string }) => {
                useSessionStore.getState().updateSession(sid, { title: data.title });
                updateLlmActivity('title-gen', { status: 'done', finishedAt: Date.now() });
              })
              .catch(() => {
                updateLlmActivity('title-gen', { status: 'error', finishedAt: Date.now() });
              });
          }
        }
      }
    });

    const offComplete = eventBus.onComplete((payload) => {
      console.debug('[EventBus] chat:complete', payload.messageId);
      // Finalize ALL streaming messages for this session — the agent loop may have produced
      // multiple assistant rows (one per LLM iteration). Without this each
      // streamed bubble keeps `streaming: true` and the typing caret blinks
      // forever even after the turn ends.
      const { streamingChunks, thinkingChunks, finalizeChunk: doFinalize, chunkSessionIds } = useSessionStore.getState();
      const ids = new Set([...Object.keys(streamingChunks), ...Object.keys(thinkingChunks)])
      ids.forEach((id) => {
        // Only finalize chunks belonging to this session
        if (!chunkSessionIds[id] || chunkSessionIds[id] === payload.sessionId) doFinalize(id);
      });
      if (payload.sessionId === useSessionStore.getState().activeSessionId) {
        setStreaming(false);
      }
    });

    const offError = eventBus.onError((payload) => {
      console.error('[EventBus] chat:error', payload);
      setStreaming(false);
      removeActiveAgentLoop(payload.sessionId);
      const { activeTurnId } = useSessionStore.getState();
      if (!activeTurnId) {
        // Error before agent turn opened (e.g. QUEUE_FULL) → floating banner
        setError(payload.message);
      } else if (payload.hadContent) {
        // Error after content was streamed → mark the turn bubble with an error indicator
        markAgentTurnError(activeTurnId, { code: payload.code, message: payload.message });
      } else if (payload.code === 'INTERRUPTED') {
        // User stopped before any content — silently remove the empty bubble
        removeLastAgentTurn();
      } else {
        // Early failure (LLM down, session deleted, not configured) — remove empty bubble, show error banner
        removeLastAgentTurn();
        setError(payload.message);
      }
    });

    const offConfirmation = eventBus.onToolConfirmation((req) => {
      setPendingConfirmation(req.sessionId, req);
      // Tool is awaiting confirmation — log it as an activity
      addToolActivity({
        callId: req.toolCallId,
        toolName: req.toolName,
        args: req.args,
        status: 'awaiting_confirmation',
        startedAt: Date.now(),
      });
    });

    const offToolStart = eventBus.onToolStart((payload) => {
      console.log('[ToolStart]', payload.toolName, 'callId:', payload.callId, 'args:', payload.args);
      // Thinking is over once the agent calls a tool — flush any live thinkingChunks
      // so the ThinkingBlock stops animating (isThinkingStreaming → false).
      flushThinkingChunks();
      // Persist this mapping permanently so older turns can still resolve tool names
      registerCallId(payload.callId, payload.toolName);
      addToolActivity({
        callId: payload.callId,
        toolName: payload.toolName,
        args: payload.args,
        status: 'running',
        startedAt: Date.now(),
      });
      // Add to active agent turn
      addTurnItem({ kind: 'tool', callId: payload.callId });
    });

    const offAgentStart = eventBus.onAgentStart((payload) => {
      console.log('[AgentStart]', payload.sessionId, payload.turnId);
      addActiveAgentLoop(payload.sessionId, payload.turnId);
      // Only manage turn state for the currently active session
      if (payload.sessionId === useSessionStore.getState().activeSessionId) {
        startAgentTurn(payload.turnId, payload.sessionId);
        clearToolActivities(); // Fresh turn = fresh tool activities
      }
    });

    const offAgentDone = eventBus.onAgentDone((payload) => {
      console.log('[AgentDone]', payload.sessionId, payload.turnId);
      removeActiveAgentLoop(payload.sessionId);
      if (payload.sessionId === useSessionStore.getState().activeSessionId) {
        finalizeAgentTurn();
      }
    });

    const offContext = eventBus.onContext((payload) => {
      if (payload.sessionId === useSessionStore.getState().activeSessionId) {
        setContext(payload.systemPrompt, payload.toolNames);
      }
    });

    const offToolResult = eventBus.onToolResult((result) => {
      console.log('[ToolResult]', result.callId, 'status:', result.status, result.status !== 'success' ? `error: ${result.errorCode}` : '');
      updateToolActivity(result.callId, {
        status: result.status === 'success' ? 'success' : result.status === 'cancelled' ? 'cancelled' : 'error',
        finishedAt: Date.now(),
        result,
      });
      // Clear accumulated live output so the cliAgentOutput map doesn't grow unbounded
      clearCLIAgentOutput(result.callId);
      // Refresh VFS file list after a successful vfs_write
      if (result.status === 'success') {
        const toolName = useAgentStore.getState().toolActivities.find((a) => a.callId === result.callId)?.toolName;
        if (toolName === 'vfs_write') setVfsRefreshSignal((n) => n + 1);
      }
      // Persist tool result into message store so RAAppManager (and chat history) can see it
      if (result.status === 'success' && result.data !== undefined) {
        const sid = useSessionStore.getState().activeSessionId;
        if (sid) {
          const toolResultMsg: ChatMessage = {
            id: nanoid(),
            sessionId: sid,
            role: 'tool_result',
            content: JSON.stringify(result.data),
            toolCallId: result.callId,
            createdAt: Date.now(),
          };
          addMessage(toolResultMsg);
        }
      }
      // Re-enable streaming state for follow-up LLM response after successful tool
      if (result.status === 'success') {
        setStreaming(true);
      }
    });

    const offCLIAgentProgress = eventBus.onCLIAgentProgress((payload) => {
      appendCLIAgentChunk(payload.callId, payload.chunk);
    });

    const offRaAppNative = eventBus.onRaAppNativeResult((payload) => {
      console.log('[RaAppNativeResult]', payload.toolCallId, payload.results);
      // Update the in-memory tool_result message to reflect executed native operations
      const sid = useSessionStore.getState().activeSessionId;
      if (!sid) return;
      const { messages: msgs, setMessages: setMsgs } = useSessionStore.getState();
      const updated = msgs.map((m) => {
        if (m.toolCallId !== payload.toolCallId || m.role !== 'tool_result') return m;
        try {
          const data = JSON.parse(m.content) as Record<string, unknown>;
          return {
            ...m,
            content: JSON.stringify({ ...data, nativeResults: payload.results, pendingApprovals: [] }),
          };
        } catch {
          return m;
        }
      });
      setMsgs(updated);
    });

    return () => {
      offChunk();
      offComplete();
      offError();
      offConfirmation();
      offToolStart();
      offAgentStart();
      offAgentDone();
      offContext();
      offToolResult();
      offCLIAgentProgress();
      offRaAppNative();
    };
  }, [appendChunk, finalizeChunk, setStreaming, setPendingConfirmation, addToolActivity, updateToolActivity, setContext, startAgentTurn, addTurnItem, finalizeAgentTurn, markAgentTurnError, removeLastAgentTurn, addActiveAgentLoop, removeActiveAgentLoop, appendCLIAgentChunk, clearCLIAgentOutput]);

  // Clear stale retry content when the user switches sessions.
  // Without this, clicking Retry after switching sessions would send the previous
  // session's message into the new session.
  useEffect(() => {
    lastSentContentRef.current = '';
  }, [activeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolActivities]);

  // Flush queued RA-App user actions when agent finishes streaming
  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      const { dequeueUserAction, activeSessionId: sid, sessions } = useSessionStore.getState();
      let action = dequeueUserAction();
      while (action && sid) {
        const session = sessions.find((s) => s.id === sid);
        if (session) {
          const userMsg: ChatMessage = {
            id: nanoid(),
            sessionId: sid,
            role: 'user',
            content: action,
            createdAt: Date.now(),
          };
          addMessage(userMsg);
          eventBus.sendMessage({ sessionId: sid, content: action, personaId: session.personaId });
        }
        action = dequeueUserAction();
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, addMessage]);

  // Latest-ref so the pending-message effect always calls the current handleSend
  const handleSendRef = useRef<(content: string, personaId: string) => void>(() => {});

  const handleSend = (content: string, personaId: string) => {
    if (!activeSessionId) return;
    // Guard against double-submit: check store state synchronously before any renders
    if (useAgentStore.getState().isStreaming) return;
    setError(null);
    setRetryError(null);
    lastSentContentRef.current = content;
    clearToolActivities();

    // Auto-generate title from first message if session still has default title
    const { sessions, updateSession } = useSessionStore.getState();
    const session = sessions.find((s) => s.id === activeSessionId);
    if (session && session.title === 'New Chat' && messages.length === 0) {
      const generatedTitle = content.slice(0, 50).trim() + (content.length > 50 ? '…' : '');
      void updateSession(activeSessionId, { title: generatedTitle });
    }

    const userMsg: ChatMessage = {
      id: nanoid(),
      sessionId: activeSessionId,
      role: 'user',
      content,
      createdAt: Date.now(),
    };
    addMessage(userMsg);

    setStreaming(true);
    console.debug('[ChatInterface] sendMessage', { sessionId: activeSessionId, content: content.slice(0, 60) });

    eventBus.sendMessage({
      sessionId: activeSessionId,
      content,
      personaId,
    });
  };

  // Keep ref current so the effect below always sees the latest handleSend
  handleSendRef.current = handleSend;

  // Auto-send pending message/RA-App when a new session becomes active
  useEffect(() => {
    if (!activeSessionId) return;
    // Reset stale streaming state from any previous session
    setStreaming(false);
    clearToolActivities();
    // Note: agentTurns are cleared by setActiveSession in the store on real session switch.
    // Do NOT call clearAgentTurns here — this effect also fires on component remount
    // (e.g. navigating home and back), which would wipe an in-flight streaming turn.
    console.debug('[ChatInterface] session activated', activeSessionId, '— streaming reset');

    // Load message history from backend
    fetch(`/api/sessions/${activeSessionId}/messages`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: ChatMessage[]) => {
        // Only apply if the session is still active when the response arrives
        if (useSessionStore.getState().activeSessionId !== activeSessionId) return;
        setMessages(data);
        // Guard: if a live agent turn is already running for this session, do NOT
        // overwrite agentTurns. setAgentTurns() also resets activeTurnId to null,
        // which would make all subsequent addTurnItem / finalizeAgentTurn calls
        // no-ops — causing the entire turn (and any RA-App widgets) to disappear.
        // This race happens when: session activates → pendingMessage auto-sent →
        // agent:start fires → fetch resolves with empty history and clobbers the
        // live turn that was just created.
        if (!useAgentStore.getState().activeAgentLoops[activeSessionId]) {
          setAgentTurns(buildTurnsFromHistory(data, activeSessionId));
        }
      })
      .catch((err: unknown) => {
        console.error('[ChatInterface] failed to load message history', err instanceof Error ? err : new Error(String(err)));
      });

    const { pendingMessage, pendingRAAppId, setPendingMessage, setPendingRAAppId, sessions: s } = useSessionStore.getState();
    const toSend = pendingMessage ?? (pendingRAAppId ? `Use the ${s.find((a) => a.id === activeSessionId)?.title ?? pendingRAAppId} tool` : null);
    if (!toSend) return;
    setPendingMessage(null);
    setPendingRAAppId(null);
    const pendingSession = s.find((sess) => sess.id === activeSessionId);
    handleSendRef.current(toSend, pendingSession?.personaId ?? 'default');
  }, [activeSessionId, setMessages, setAgentTurns]);

  const handleStop = () => {
    if (!activeSessionId) return;
    eventBus.stopTurn(activeSessionId);
  };

  const handleCompactNow = () => {
    if (!activeSessionId) return;
    const compacted = compactMessages(messages, 'auto-trim');
    setMessages(compacted);
    setShowContextStats(false);
  };

  const [copied, setCopied] = useState(false);
  const handleCopyChat = () => {
    const text = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const who = m.role === 'user' ? 'You' : 'Kalio';
        return `${who}: ${m.content}`;
      })
      .join('\n\n');
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      console.log('[ChatInterface] chat copied to clipboard', { messageCount: messages.length });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div data-testid="chat-interface" className="flex h-full flex-col bg-base-200 rounded-xl border border-base-300 overflow-hidden">
      {error && (
        <div data-testid="chat-error" className="alert alert-error m-2 py-2 text-sm">
          {error}
          <button className="btn btn-ghost btn-xs ml-auto" onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {retryError && (
        <div data-testid="chat-retry-error" className="alert alert-warning m-2 py-2 text-sm flex items-center gap-2">
          <span className="flex-1">{retryError}</span>
          <button
            className="btn btn-xs btn-warning"
            onClick={() => {
              const content = lastSentContentRef.current;
              const session = sessions.find((s) => s.id === activeSessionId);
              if (content && session) {
                setRetryError(null);
                handleSend(content, session.personaId);
              }
            }}
          >
            Retry
          </button>
          <button className="btn btn-ghost btn-xs" onClick={() => setRetryError(null)}>✕</button>
        </div>
      )}

      {/* Session header */}
      {activeSession && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-base-300 shrink-0">
          <span className="text-sm font-medium truncate flex-1">{activeSession.title}</span>
          <ConversationFilesBar sessionId={activeSessionId!} refreshSignal={vfsRefreshSignal} />
          {messages.length > 0 && (
            <button
              className="btn btn-ghost btn-xs text-base-content/40 hover:text-base-content/70"
              onClick={handleCopyChat}
              title="Copy chat to clipboard"
            >
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            </button>
          )}
          <div className="relative shrink-0">
            <TokenBadge tokenCount={tokenCount} onClick={() => setShowContextStats((v) => !v)} />
            {showContextStats && (
              <ContextStats
                tokenCount={tokenCount}
                onCompactNow={needsCompact ? handleCompactNow : undefined}
                onClose={() => setShowContextStats(false)}
                systemPrompt={systemPrompt}
                activeToolNames={activeToolNames}
              />
            )}
          </div>
          {activeModel && (
            <span className="text-[10px] font-mono text-base-content/35 shrink-0 truncate max-w-[9rem]" title={activeModel}>
              {activeModel}
            </span>
          )}
        </div>
      )}

      <div data-testid="message-list" className="flex-1 overflow-y-auto p-4 space-y-1">
        {/* Welcome screen — only when no messages */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-5 max-w-sm mx-auto px-4" data-testid="welcome-screen">
            <div className="text-center select-none">
              <div className="text-primary font-black text-4xl drop-shadow-[0_0_12px_oklch(0.60_0.176_232.6/0.6)] mb-2">K</div>
              <h2 className="text-base font-semibold text-base-content/80">KALIO</h2>
              <p className="text-base-content/45 text-xs mt-1 leading-relaxed max-w-60">
                AI assistant — build apps, query data, generate images, run tools
              </p>
            </div>
            {activeSessionId && personas.length > 1 && (
              <div className="w-full max-w-xs">
                <label className="text-[10px] uppercase tracking-wider text-base-content/35 mb-1 block pl-1">
                  Persona
                </label>
                <select
                  className="select select-bordered select-sm w-full text-sm"
                  value={activeSession?.personaId ?? 'default'}
                  onChange={(e) => void handlePersonaChange(e.target.value)}
                  disabled={isStreaming}
                  data-testid="welcome-persona-select"
                >
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
            {activeSessionId && (
              <div className="flex flex-wrap justify-center gap-2 mt-1">
                {['What can you do?', 'Build a calculator app', 'Create a todo list', 'Generate an image of a fox'].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="btn btn-sm btn-ghost border border-base-300/70 text-xs text-base-content/70 hover:text-primary hover:border-primary/40"
                    onClick={() => handleSend(prompt, activeSession?.personaId ?? 'default')}
                    disabled={isStreaming}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Interleaved timeline: user message → agent turn → user message → ... */}
        {(() => {
          const userMsgs = messages.filter((m) => m.role === 'user');
          const timeline: React.ReactNode[] = [];
          const maxLen = Math.max(userMsgs.length, agentTurns.length);
          for (let i = 0; i < maxLen; i++) {
            if (i < userMsgs.length) {
              timeline.push(<MessageBubble key={userMsgs[i].id} message={userMsgs[i]} />);
            }
            if (i < agentTurns.length) {
              timeline.push(
                <AgentTurnBubble
                  key={agentTurns[i].id}
                  turn={agentTurns[i]}
                  toolActivities={toolActivities}
                  answeredCallIds={answeredCallIds}
                />,
              );
            }
          }
          return timeline;
        })()}

        {/* Generic streaming indicator when streaming with no messages yet */}
        {isStreaming && toolActivities.length === 0 && messages.length === 0 && (
          <div className="flex justify-start">
            <div className="bg-base-300 rounded-2xl px-4 py-2">
              <span data-testid="streaming-indicator" className="loading loading-dots loading-xs" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <ChatInput onSend={handleSend} disabled={isStreaming || !activeSessionId} isStreaming={isStreaming} onStop={handleStop} />
    </div>
  );
}
