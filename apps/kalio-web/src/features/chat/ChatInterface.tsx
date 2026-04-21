import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { eventBus } from '../../services/eventBus';
import { MessageBubble } from './MessageBubble';
import { ToolActivityRow } from './ToolActivityRow';
import { ChatInput } from './ChatInput';
import { ConfirmationDialog } from './ConfirmationDialog';
import type { ChatMessage } from '@kalio/types';

export function ChatInterface() {
  const { messages, activeSessionId, addMessage, appendChunk, finalizeChunk } = useSessionStore();
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
  const bottomRef = useRef<HTMLDivElement>(null);

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

  return (
    <div data-testid="chat-interface" className="flex h-full flex-col bg-base-200 rounded-xl border border-base-300 overflow-hidden">
      {error && (
        <div data-testid="chat-error" className="alert alert-error m-2 py-2 text-sm">
          {error}
          <button className="btn btn-ghost btn-xs ml-auto" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div data-testid="message-list" className="flex-1 overflow-y-auto p-4 space-y-1">
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
