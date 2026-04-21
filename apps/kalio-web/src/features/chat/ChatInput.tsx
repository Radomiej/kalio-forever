import { useState, useRef, type KeyboardEvent } from 'react';
import { useSessionStore } from '../../store/sessionStore';

interface ChatInputProps {
  onSend: (content: string, personaId: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { activeSessionId } = useSessionStore();

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    // personaId resolved server-side from session — pass placeholder
    onSend(trimmed, 'default');
    setValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div data-testid="chat-input-area" className="border-t border-base-300 bg-base-100 p-3">
      {!activeSessionId && (
        <p data-testid="no-session-hint" className="mb-2 text-xs text-base-content/50">
          Select or create a session to start chatting.
        </p>
      )}
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          className="textarea textarea-bordered flex-1 resize-none text-sm"
          placeholder={disabled && !activeSessionId ? 'Select a session first…' : 'Message…'}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          data-testid="send-button"
          className="btn btn-primary btn-sm self-end"
          disabled={disabled || !value.trim()}
          onClick={handleSend}
        >
          Send
        </button>
      </div>
    </div>
  );
}
