import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { useSettingsStore } from '../settings/settingsStore';
import { eventBus } from '../../services/eventBus';
import { MessageBubble } from './MessageBubble';
import { ToolActivityRow } from './ToolActivityRow';
import { ChatInput } from './ChatInput';
import { ConfirmationDialog } from './ConfirmationDialog';
import { TokenBadge } from './TokenBadge';
import { ContextStats } from './ContextStats';
import { useContextUsage } from './hooks/useContextUsage';
import type { ChatMessage } from '@kalio/types';

export function ChatInterface() {
  const { messages, activeSessionId, sessions, addMessage, appendChunk, finalizeChunk, setMessages, updateSession } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const activeModel = useSettingsStore((s) => s.getEffectiveModel());
  const contextWindow = useSettingsStore((s) => s.getEffectiveContextWindow());
  const {
    isStreaming,
    pendingConfirmation,
    toolActivities,
    setStreaming,
    setPendingConfirmation,
    addToolActivity,
    updateToolActivity,
    clearToolActivities,
  } = useAgentStore();
  const [error, setError] = useState<string | null>(null);
  const [showContextStats, setShowContextStats] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Context usage monitoring
  const { tokenCount, needsCompact, compactMessages } = useContextUsage();

  useEffect(() => {
    if (!eventBus.connected) eventBus.connect();

    const offChunk = eventBus.onChunk((chunk) => {
      if (!chunk.done) {
        appendChunk(chunk.messageId, chunk.delta, chunk.thinking);
      } else {
        finalizeChunk(chunk.messageId);
        setStreaming(false);
      }
    });

    const offComplete = eventBus.onComplete(() => setStreaming(false));

    const offError = eventBus.onError((payload) => {
      setStreaming(false);
      setError(payload.message);
    });

    const offConfirmation = eventBus.onToolConfirmation((req) => {
      setPendingConfirmation(req);
      // Tool is awaiting confirmation — log it as an activity
      addToolActivity({
        callId: req.toolCallId,
        toolName: req.toolName,
        args: req.args,
        status: 'awaiting_confirmation',
        startedAt: Date.now(),
      });
    });

    const offToolResult = eventBus.onToolResult((result) => {
      updateToolActivity(result.callId, {
        status: result.status === 'success' ? 'success' : result.status === 'cancelled' ? 'cancelled' : 'error',
        finishedAt: Date.now(),
        result,
      });
      // Re-enable streaming state for follow-up LLM response after successful tool
      if (result.status === 'success') {
        setStreaming(true);
      }
    });

    return () => {
      offChunk();
      offComplete();
      offError();
      offConfirmation();
      offToolResult();
    };
  }, [appendChunk, finalizeChunk, setStreaming, setPendingConfirmation, addToolActivity, updateToolActivity]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolActivities]);

  const handleSend = (content: string, personaId: string) => {
    if (!activeSessionId) return;
    setError(null);
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

    eventBus.sendMessage({
      sessionId: activeSessionId,
      content,
      personaId,
      conversationId: activeSessionId,
    });
  };

  const handleConfirm = () => {
    if (!pendingConfirmation || !activeSessionId) return;
    updateToolActivity(pendingConfirmation.toolCallId, { status: 'running', startedAt: Date.now() });
    eventBus.confirmTool({ requestId: pendingConfirmation.requestId, sessionId: activeSessionId });
    setPendingConfirmation(null);
  };

  const handleCancel = () => {
    if (!pendingConfirmation || !activeSessionId) return;
    updateToolActivity(pendingConfirmation.toolCallId, { status: 'cancelled', finishedAt: Date.now() });
    eventBus.cancelTool({ requestId: pendingConfirmation.requestId, sessionId: activeSessionId });
    setPendingConfirmation(null);
  };

  const handleCompactNow = () => {
    if (!activeSessionId) return;
    const compacted = compactMessages(messages, 'auto-trim');
    setMessages(compacted);
    setShowContextStats(false);
  };

  return (
    <div data-testid="chat-interface" className="flex h-full flex-col bg-base-200 rounded-xl border border-base-300 overflow-hidden">
      {error && (
        <div data-testid="chat-error" className="alert alert-error m-2 py-2 text-sm">
          {error}
          <button className="btn btn-ghost btn-xs ml-auto" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Session header */}
      {activeSession && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-base-300 shrink-0">
          <span className="text-sm font-medium truncate flex-1">{activeSession.title}</span>
          <div className="relative shrink-0">
            <TokenBadge tokenCount={tokenCount} onClick={() => setShowContextStats((v) => !v)} />
            {showContextStats && (
              <ContextStats
                tokenCount={tokenCount}
                onCompactNow={needsCompact ? handleCompactNow : undefined}
                onClose={() => setShowContextStats(false)}
              />
            )}
          </div>
          {activeModel && (
            <span className="text-[10px] font-mono text-base-content/35 shrink-0 truncate max-w-[9rem]" title={`${activeModel} · ctx ${(contextWindow / 1000).toFixed(0)}k`}>
              {activeModel} · {(contextWindow / 1000).toFixed(0)}k
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
            {activeSessionId && (
              <div className="flex flex-wrap justify-center gap-2 mt-1">
                {['What can you do?', 'Build a calculator app', 'Create a todo list', 'Generate an image of a fox'].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="btn btn-sm btn-ghost border border-base-300/70 text-xs text-base-content/70 hover:text-primary hover:border-primary/40"
                    onClick={() => handleSend(prompt, 'default')}
                    disabled={isStreaming}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Tool activity rows — shown at the bottom of the current turn */}
        {toolActivities.map((activity) => (
          <ToolActivityRow key={activity.callId} activity={activity} />
        ))}

        {/* Generic streaming indicator when streaming but no tool activity */}
        {isStreaming && toolActivities.length === 0 && messages.length === 0 && (
          <div className="flex justify-start">
            <div className="bg-base-300 rounded-2xl px-4 py-2">
              <span data-testid="streaming-indicator" className="loading loading-dots loading-xs" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <ChatInput onSend={handleSend} disabled={isStreaming || !activeSessionId} />

      {pendingConfirmation && (
        <ConfirmationDialog
          request={pendingConfirmation}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
