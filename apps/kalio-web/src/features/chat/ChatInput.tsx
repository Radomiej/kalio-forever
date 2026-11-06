import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Send, Square, Zap } from 'lucide-react';
import { useComposerImages, type ComposerSendOptions } from './composerImages';
import { VoiceInputControl } from '../voice/VoiceInputControl';
import { useSessionStore } from '../../store/sessionStore';
import type { ArchitectSchema } from '../architect/architect.types';

interface ChatInputProps {
  onSend: (content: string, personaId: string, options?: ComposerSendOptions) => boolean | void | Promise<boolean | void>;
  imageInputBlockReason?: string;
  disabled: boolean;
  isStreaming?: boolean;
  queuedDepth?: number;
  onStop?: () => void;
  architectures?: Pick<ArchitectSchema, 'id' | 'name'>[];
  selectedArchitectureId?: string;
  onArchitectureChange?: (schemaId: string) => void;
  onArchitectureRun?: (content: string, schemaId: string) => void;
  onDraftChange?: (content: string) => void;
  architectureLocked?: boolean;
}

export function ChatInput({
  architectures = [],
  disabled,
  imageInputBlockReason,
  isStreaming = false,
  queuedDepth = 0,
  onArchitectureChange,
  onArchitectureRun,
  onDraftChange,
  onSend,
  onStop,
  architectureLocked = false,
  selectedArchitectureId = 'single-chat',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [sendingImages, setSendingImages] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { activeSessionId, sessions } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const blockReason = imageInputBlockReason ?? (selectedArchitectureId !== 'single-chat'
    ? 'Image attachments are unavailable in this workflow.'
    : !activeSessionId ? 'Select a session to add images.' : undefined);
  const imageDraft = useComposerImages(blockReason, disabled || sendingImages);
  const hasText = value.trim().length > 0;
  const showStopButton = Boolean(onStop) && isStreaming;

  const handleSend = (interrupt = false) => {
    const trimmed = value.trim();
    if (!trimmed || disabled || sendingImages) return;
    if (imageDraft.images.length) {
      if (blockReason) return;
      setSendingImages(true);
      void Promise.resolve(onSend(trimmed, activeSession?.personaId ?? 'default', { interrupt, images: imageDraft.images }))
        .then((sent) => {
          if (sent !== false) {
            imageDraft.clear();
            clearText();
          }
        }).finally(() => setSendingImages(false));
      return;
    }

    const activeArchitecture = architectures.find((schema) => schema.id === selectedArchitectureId) ?? null;
    if (activeArchitecture && onArchitectureRun) {
      if (isStreaming) {
        return;
      }
      onArchitectureRun(trimmed, activeArchitecture.id);
    } else {
      onSend(trimmed, activeSession?.personaId ?? 'default', { interrupt });
    }
    clearText();
  };

  const clearText = () => {
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
      {imageDraft.preview && <div className="px-3 pt-2">{imageDraft.preview}</div>}
      <div className="flex items-center gap-2 px-3 pb-3 pt-2">
        <div className="min-w-0 flex-1 flex flex-wrap sm:flex-nowrap items-center border-2 border-base-300 rounded-2xl bg-base-100 focus-within:border-sky-500/60 transition-colors px-3 py-1.5 gap-2 min-h-[44px]">
          {!activeSessionId && onArchitectureChange && (
            <select
              aria-label="Architecture runtime"
              className="select select-bordered select-xs h-8 min-h-8 w-full shrink-0 bg-base-200 text-[11px] sm:w-48"
              value={selectedArchitectureId}
              onChange={(event) => onArchitectureChange(event.target.value)}
              disabled={disabled || architectureLocked}
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
            className="min-w-0 basis-full sm:basis-0 flex-1 resize-none min-h-6 max-h-40 text-sm bg-transparent border-0 outline-none focus:outline-none leading-6 py-0 placeholder:text-base-content/45"
            placeholder={disabled && !activeSessionId ? 'Select a session first…' : 'Ask Kalio…'}
            rows={1}
            value={value}
            disabled={disabled || sendingImages}
            onPaste={imageDraft.onPaste}
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
              disabled={sendingImages || Boolean(blockReason && imageDraft.images.length)}
              onClick={() => handleSend(true)}
              aria-label="Interrupt and send"
              type="button"
            >
              <Zap size={14} />
              <span className="hidden sm:inline text-[11px]">Interrupt</span>
            </button>
          )}
          {imageDraft.picker}
          <div data-testid="chat-voice-send" className="ml-auto flex flex-wrap min-w-0 max-w-full items-center justify-end gap-2">
            <VoiceInputControl scope={activeSessionId ? { sessionId: activeSessionId } : null} draft={value} disabled={disabled || sendingImages} onDraft={(text) => {
              setValue(text); onDraftChange?.(text);
            }} />
            <button
              data-testid="chat-send-btn"
              className="btn btn-sm h-11 min-h-11 w-11 p-0 bg-[#00D535] border-none text-white hover:bg-[#00C030] rounded-full shrink-0 disabled:opacity-40"
              disabled={disabled || sendingImages || !hasText || Boolean(blockReason && imageDraft.images.length)}
              onClick={() => handleSend(false)}
              aria-label="Send message"
              type="button"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
