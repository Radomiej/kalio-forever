import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Send, Square, Zap } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import type { ArchitectSchema } from '../architect/architect.types';

interface ChatInputProps {
  onSend: (content: string, personaId: string, options?: { interrupt?: boolean }) => void;
  disabled: boolean;
  isStreaming?: boolean;
  queuedDepth?: number;
  onStop?: () => void;
  architectures?: Pick<ArchitectSchema, 'id' | 'name'>[];
  selectedArchitectureId?: string;
  onArchitectureChange?: (schemaId: string) => void;
  onArchitectureRun?: (content: string, schemaId: string) => void;
  onDraftChange?: (content: string) => void;
}

export function ChatInput({
  architectures = [],
  disabled,
  isStreaming = false,
  queuedDepth = 0,
  onArchitectureChange,
  onArchitectureRun,
  onDraftChange,
  onSend,
  onStop,
  selectedArchitectureId = 'single-chat',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSendAtRef = useRef(0);
  const { activeSessionId, sessions } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const hasText = value.trim().length > 0;
  const showStopButton = Boolean(onStop) && isStreaming;

  const handleSend = (interrupt = false) => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    const now = Date.now();
    if (now - lastSendAtRef.current < 150) return;
    lastSendAtRef.current = now;

    const activeArchitecture = architectures.find((schema) => schema.id === selectedArchitectureId) ?? null;
    if (activeArchitecture && onArchitectureRun) {
      if (isStreaming) {
        return;
      }
      onArchitectureRun(trimmed, activeArchitecture.id);
    } else {
      onSend(trimmed, activeSession?.personaId ?? 'default', { interrupt });
    }
    setValue('');
    onDraftChange?.('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (e.altKey && isStreaming) {
        handleSend(true);
        return;
      }
      handleSend(false);
    }
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  useEffect(() => {
    if (!isStreaming && queuedDepth === 0) return;
  }, [isStreaming, queuedDepth]);

  return (
    <div data-testid="chat-input-area" className="bg-base-100 border-t border-base-300">
      {!activeSessionId && (
        <p data-testid="no-session-hint" className="px-4 pt-2 text-xs text-base-content/50">
          Select or create a session to start chatting.
        </p>
      )}
      {queuedDepth > 0 && (
        <p data-testid="chat-queued-badge" className="px-4 pt-2 text-xs text-info">
          Queued ({queuedDepth})
        </p>
      )}
      <div className="flex items-center gap-2 px-3 pb-3 pt-2">
        <div className="flex-1 flex items-center border-2 border-base-300 rounded-2xl bg-base-100 focus-within:border-sky-500/60 transition-colors px-3 py-1.5 gap-2 min-h-[44px]">
          {onArchitectureChange && (
            <select
              aria-label="Architecture runtime"
              className="select select-bordered select-xs h-8 min-h-8 w-36 shrink-0 bg-base-200 text-[11px] sm:w-48"
              value={selectedArchitectureId}
              onChange={(event) => onArchitectureChange(event.target.value)}
              disabled={disabled}
              data-testid="chat-architecture-select"
            >
              <option value="single-chat">Single Chat</option>
              {architectures.map((schema) => (
                <option key={schema.id} value={schema.id}>{schema.name}</option>
              ))}
            </select>
          )}
          <textarea
            ref={textareaRef}
            aria-label="Chat message"
            data-testid="chat-input"
            className="flex-1 resize-none min-h-6 max-h-40 text-sm bg-transparent border-0 outline-none focus:outline-none leading-6 py-0 placeholder:text-base-content/45"
            placeholder={disabled && !activeSessionId ? 'Select a session first…' : 'Ask Kalio…'}
            rows={1}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              setValue(e.target.value);
              onDraftChange?.(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
          />
          {showStopButton && (
            <button
              data-testid="chat-stop-btn"
              className="btn btn-sm h-[32px] w-[32px] p-0 bg-error border-none text-white hover:bg-error/80 rounded-full shrink-0"
              onClick={onStop}
              aria-label="Stop agent"
              type="button"
            >
              <Square size={14} fill="currentColor" />
            </button>
          )}
          {isStreaming && hasText && (
            <button
              data-testid="chat-interrupt-btn"
              className="btn btn-sm h-[32px] px-2 bg-warning border-none text-warning-content hover:bg-warning/80 rounded-full shrink-0 gap-1"
              onClick={() => handleSend(true)}
              aria-label="Interrupt and send"
              type="button"
            >
              <Zap size={14} />
              <span className="hidden sm:inline text-[11px]">Interrupt</span>
            </button>
          )}
          <button
            data-testid="chat-send-btn"
            className="btn btn-sm h-[32px] w-[32px] p-0 bg-[#00D535] border-none text-white hover:bg-[#00C030] rounded-full shrink-0 disabled:opacity-40"
            disabled={disabled || !hasText}
            onClick={() => handleSend(false)}
            aria-label="Send message"
            type="button"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
