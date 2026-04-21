import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { eventBus } from '../../services/eventBus';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { ConfirmationDialog } from './ConfirmationDialog';
import type { ChatMessage } from '@kalio/types';

export function ChatInterface() {
  const { messages, activeSessionId, addMessage, appendChunk, finalizeChunk } = useSessionStore();
  const { isStreaming, pendingConfirmation, setStreaming, setPendingConfirmation } = useAgentStore();
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!eventBus.connected) eventBus.connect();

    const offChunk = eventBus.onChunk((chunk) => {
      if (!chunk.done) {
        appendChunk(chunk.messageId, chunk.delta);
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
    });

    return () => {
      offChunk();
      offComplete();
      offError();
      offConfirmation();
    };
  }, [appendChunk, finalizeChunk, setStreaming, setPendingConfirmation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (content: string, personaId: string) => {
    if (!activeSessionId) return;
    setError(null);

    const userMsg: ChatMessage = {
      id: nanoid(),
      sessionId: activeSessionId,
      role: 'user',
      content,
      createdAt: Date.now(),
    };
    addMessage(userMsg);

    const streamingId = nanoid();
    setStreaming(true, streamingId);
    addMessage({
      id: streamingId,
      sessionId: activeSessionId,
      role: 'assistant',
      content: '',
      streaming: true,
      createdAt: Date.now(),
    });

    eventBus.sendMessage({
      sessionId: activeSessionId,
      content,
      personaId,
      conversationId: activeSessionId,
    });
  };

  const handleConfirm = () => {
    if (!pendingConfirmation || !activeSessionId) return;
    eventBus.confirmTool({ requestId: pendingConfirmation.requestId, sessionId: activeSessionId });
    setPendingConfirmation(null);
  };

  const handleCancel = () => {
    if (!pendingConfirmation || !activeSessionId) return;
    eventBus.cancelTool({ requestId: pendingConfirmation.requestId, sessionId: activeSessionId });
    setPendingConfirmation(null);
  };

  return (
    <div data-testid="chat-interface" className="flex h-full flex-col">
      {error && (
        <div data-testid="chat-error" className="alert alert-error m-2 py-2 text-sm">
          {error}
          <button className="btn btn-ghost btn-xs ml-auto" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div data-testid="message-list" className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
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
