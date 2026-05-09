import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';

interface ChatInputProps {
  onSend: (content: string, personaId: string) => void;
  disabled: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
}

export function ChatInput({ onSend, disabled, isStreaming = false, onStop }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [isSendLocked, setIsSendLocked] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sawParentDisableRef = useRef(false);
  const { activeSessionId, sessions } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const effectiveDisabled = disabled || isSendLocked;

  useEffect(() => {
    if (!isSendLocked) return;

    if (disabled) {
      sawParentDisableRef.current = true;
      return;
    }

    if (sawParentDisableRef.current) {
      sawParentDisableRef.current = false;
      setIsSendLocked(false);
    }
  }, [disabled, isSendLocked]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || effectiveDisabled) return;

    sawParentDisableRef.current = false;
    setIsSendLocked(true);
    try {
      onSend(trimmed, activeSession?.personaId ?? 'default');
    } catch (error) {
      setIsSendLocked(false);
      throw error;
    }
    setValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  return (
    <div data-testid="chat-input-area" className="bg-base-100 border-t border-base-300">
      {!activeSessionId && (
        <p data-testid="no-session-hint" className="px-4 pt-2 text-xs text-base-content/50">
          Select or create a session to start chatting.
        </p>
      )}
      <div className="flex items-center gap-2 px-3 pb-3 pt-2">
        {/* Pill container */}
        <div className="flex-1 flex items-center border-2 border-base-300 rounded-2xl bg-base-100 focus-within:border-sky-500/60 transition-colors px-3 py-1.5 gap-2 min-h-[44px]">
          <textarea
            ref={textareaRef}
            data-testid="chat-input"
            className="flex-1 resize-none min-h-6 max-h-40 text-sm bg-transparent border-0 outline-none focus:outline-none leading-6 py-0 placeholder:text-base-content/45"
            placeholder={disabled && !activeSessionId ? 'Select a session first…' : 'Ask Kalio…'}
            rows={1}
            value={value}
            disabled={effectiveDisabled}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
          />
          {isStreaming && onStop ? (
            <button
              data-testid="chat-stop-btn"
              className="btn btn-sm h-[32px] w-[32px] p-0 bg-error border-none text-white hover:bg-error/80 rounded-full shrink-0"
              onClick={onStop}
              aria-label="Stop agent"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              data-testid="chat-send-btn"
              className="btn btn-sm h-[32px] w-[32px] p-0 bg-[#00D535] border-none text-white hover:bg-[#00C030] rounded-full shrink-0 disabled:opacity-40"
              disabled={effectiveDisabled || !value.trim()}
              onClick={handleSend}
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
