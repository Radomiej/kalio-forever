import { useEffect, useId, useRef, useState } from 'react';
import { BrainCircuit, ChevronDown } from 'lucide-react';

export function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(false);
  const didAutoOpen = useRef(false);
  const contentId = useId();
  useEffect(() => {
    if (isStreaming && content.length > 0 && !didAutoOpen.current) {
      didAutoOpen.current = true;
      setOpen(true);
    }
    if (!isStreaming) didAutoOpen.current = false;
  }, [isStreaming, content.length]);
  return (
    <div className="border border-base-content/10 rounded-lg overflow-hidden">
      <button type="button" aria-expanded={open} aria-controls={contentId} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-base-content/50 hover:text-base-content/70 transition-colors bg-base-200/50" onClick={() => setOpen((v) => !v)}>
        <BrainCircuit size={12} className={isStreaming ? 'text-sky-400 animate-pulse' : 'text-base-content/40'} />
        <span>Thinking</span>
        {isStreaming && <span className="loading loading-dots loading-xs ml-1" />}
        <ChevronDown size={12} className={`ml-auto transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div id={contentId} hidden={!open} className="px-3 py-2 text-xs text-base-content/50 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-base-200/20">
        {content}
        {isStreaming && <span className="inline-block h-3 w-0.5 animate-pulse bg-current ml-0.5" />}
      </div>
    </div>
  );
}
