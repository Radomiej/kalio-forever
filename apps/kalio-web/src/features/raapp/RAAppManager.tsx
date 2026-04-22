import { useMemo, useState } from 'react';
import { Code2, Globe, Eye, RefreshCw } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { RAAppRenderer } from './RAAppRenderer';
import type { RAAppBlock } from '@kalio/types';

interface FoundRAApp {
  messageId: string;
  block: RAAppBlock;
  index: number;
}

export function RAAppManager({ onOpenVFS, onRunWithAgent }: { onOpenVFS: (appId: string) => void; onRunWithAgent: () => void }) {
  void onOpenVFS;
  void onRunWithAgent;

  const messages = useSessionStore((s) => s.messages);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const apps = useMemo<FoundRAApp[]>(() => {
    const found: FoundRAApp[] = [];
    let idx = 0;
    for (const msg of messages) {
      if (msg.role !== 'tool_result' || !msg.content) continue;
      try {
        const parsed: unknown = JSON.parse(msg.content);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          'type' in parsed &&
          'content' in parsed &&
          ((parsed as { type: string }).type === 'html' || (parsed as { type: string }).type === 'gui')
        ) {
          const block = parsed as RAAppBlock;
          found.push({ messageId: msg.id, block, index: idx++ });
        }
      } catch {
        // not JSON — skip
      }
    }
    return found;
  }, [messages]);

  const selected = selectedIdx !== null ? apps[selectedIdx] ?? null : null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-base-300 shrink-0 flex items-center justify-between">
        <span className="text-xs font-semibold text-base-content/60 uppercase tracking-wider">
          RA-Apps ({apps.length})
        </span>
      </div>

      {apps.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-4">
          <RefreshCw size={24} className="text-base-content/20" />
          <p className="text-sm text-base-content/40">No RA-Apps in current session</p>
          <p className="text-xs text-base-content/30">
            Ask the assistant to create an HTML or GUI app
          </p>
        </div>
      )}

      {apps.length > 0 && (
        <>
          <div className="flex flex-col gap-1 p-2 overflow-y-auto shrink-0 max-h-48 border-b border-base-300">
            {apps.map((app, i) => (
              <button
                key={app.messageId + i}
                onClick={() => setSelectedIdx(i)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors ${
                  selectedIdx === i
                    ? 'bg-sky-500/15 text-sky-400'
                    : 'hover:bg-base-200 text-base-content/70'
                }`}
              >
                {app.block.type === 'html' ? (
                  <Globe size={14} className="shrink-0" />
                ) : (
                  <Code2 size={14} className="shrink-0" />
                )}
                <span className="flex-1 truncate">
                  {app.block.type.toUpperCase()} App #{i + 1}
                </span>
                <span className="text-xs text-base-content/40 shrink-0 flex items-center gap-1">
                  <Eye size={10} />
                  {app.block.mode}
                </span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto p-2">
            {selected ? (
              <RAAppRenderer block={selected.block} />
            ) : (
              <p className="text-xs text-base-content/40 text-center pt-4">
                Select an app to preview
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

