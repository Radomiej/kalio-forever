import { useState, useRef, useCallback } from 'react';
import { Send } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';

interface QuickChatWidgetProps {
  /** Called after the message is dispatched so the parent can switch views */
  onMessageSent: () => void;
}

export function QuickChatWidget({ onMessageSent }: QuickChatWidgetProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const createSession = useSessionStore((s) => s.createSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setPendingMessage = useSessionStore((s) => s.setPendingMessage);

  const handleSend = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Create a new session
    const sessionId = createSession('New Chat');
    
    // Store the message before navigating so ChatInterface can auto-send it
    setPendingMessage(trimmed);

    // Set it as active
    setActiveSession(sessionId);
    
    setValue('');
    onMessageSent();
  }, [value, createSession, setActiveSession, setPendingMessage, onMessageSent]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className="col-span-full rounded-xl bg-base-200/80 backdrop-blur border border-base-300 p-4 flex flex-col gap-2"
      data-testid="quick-chat-widget"
    >
      <div className="flex items-center gap-2 text-xs text-base-content/50 font-medium">
        <span className="text-primary font-black text-base drop-shadow-[0_0_6px_oklch(0.60_0.176_232.6/0.5)]">K</span>
        <span>Quick Chat</span>
      </div>

      <div className="flex gap-2 items-end">
        <textarea
          ref={inputRef}
          className="textarea textarea-bordered flex-1 min-h-[40px] max-h-[80px] resize-none text-sm leading-snug"
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          data-testid="quick-chat-input"
          aria-label="Quick chat message"
          title="Quick chat message"
        />
        <button
          type="button"
          className="btn btn-primary btn-sm h-10 w-10 p-0 flex items-center justify-center"
          disabled={!value.trim()}
          onClick={handleSend}
          data-testid="quick-chat-send"
          aria-label="Send message"
          title="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
