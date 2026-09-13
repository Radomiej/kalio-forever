import { useState } from 'react';
import { X, Minimize2, ChevronDown } from 'lucide-react';
import { formatTokenCount, type TokenCount } from '../../services/tokenCounter';
import type { LLMContent, LLMContextPreview } from '@kalio/types';

export interface RawContextStats {
  contextLimit: number;
  systemPromptChars: number;
  activeToolNames: string[];
  history: Array<{ id: string; role: string; textChars: number; preview?: string }>;
  imageCount: number;
}

interface ContextStatsProps {
  tokenCount: TokenCount;
  onCompactNow?: () => void;
  onClose: () => void;
  systemPrompt?: string | null;
  activeToolNames?: string[];
  contextPreview?: LLMContextPreview | null;
  contextPreviewStatus?: ContextPreviewStatus;
}

export interface ContextPreviewStatus {
  loading: boolean;
  stale: boolean;
  error: string | null;
}

// ── Category config ────────────────────────────────────────────────────────────

interface CategoryDef {
  key: keyof TokenCount['breakdown'];
  label: string;
  color: string; // Tailwind bg class
  barColor: string; // For the stacked bar
}

const CATEGORIES: CategoryDef[] = [
  { key: 'tools', label: 'Tools definition', color: 'bg-info', barColor: 'bg-info' },
  { key: 'systemPrompt', label: 'System prompt', color: 'bg-secondary', barColor: 'bg-secondary' },
  { key: 'skills', label: 'Skills', color: 'bg-warning', barColor: 'bg-warning' },
  { key: 'history', label: 'History', color: 'bg-success', barColor: 'bg-success' },
  { key: 'images', label: 'Images', color: 'bg-accent', barColor: 'bg-accent' },
];

// ── Component ──────────────────────────────────────────────────────────────────

function contentToPreviewText(content: LLMContent): string {
  return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
}

function valueToPreviewText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function ContextStats({ tokenCount, onCompactNow, onClose, systemPrompt, activeToolNames, contextPreview, contextPreviewStatus }: ContextStatsProps) {
  const { total, breakdown, cacheable, contextLimit, usagePercent } = tokenCount;
  const [promptOpen, setPromptOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);

  const barColor =
    usagePercent >= 95
      ? 'text-error'
      : usagePercent >= 80
        ? 'text-warning'
        : 'text-primary';

  return (
    <div
      className="absolute right-0 top-full mt-1 z-50 w-80 bg-base-200 border border-base-300 rounded-box shadow-xl p-3 text-xs"
      data-testid="context-stats-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="font-semibold text-sm">Context Usage</span>
          <p className="mt-0.5 text-[10px] text-base-content/45" data-testid="context-stats-source">
            Preflight estimate · exact provider usage is logged after completion
          </p>
        </div>
        <div className="flex items-center gap-1">
          {onCompactNow && (
            <button
              type="button"
              className="btn btn-ghost btn-xs gap-1"
              onClick={onCompactNow}
              title="Compact now — trim old messages"
              data-testid="compact-now-btn"
            >
              <Minimize2 size={12} />
              Compact
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-square"
            onClick={onClose}
            data-testid="context-stats-close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Stacked progress bar */}
      <div className="mb-3" data-testid="context-stats-bar">
        <div className="flex items-center justify-between mb-1">
          <span className={`font-mono font-semibold ${barColor}`}>
            ~{formatTokenCount(total)} / {formatTokenCount(contextLimit)}
          </span>
          <span className={`font-mono ${barColor}`}>{usagePercent}%</span>
        </div>
        <div className="w-full h-3 bg-base-300 rounded-full overflow-hidden flex">
          {CATEGORIES.map((cat) => {
            const tokens = breakdown[cat.key];
            if (tokens <= 0) return null;
            const widthPercent = total > 0 ? (tokens / contextLimit) * 100 : 0;
            return (
              <div
                key={cat.key}
                className={`${cat.barColor} h-full transition-all duration-300`}
                style={{ width: `${Math.max(widthPercent, 0.5)}%` }}
                title={`${cat.label}: ${tokens.toLocaleString()} tokens`}
              />
            );
          })}
        </div>
      </div>

      {/* Category breakdown */}
      <div className="space-y-1.5 mb-3" data-testid="context-stats-breakdown">
        {CATEGORIES.map((cat) => {
          const tokens = breakdown[cat.key];
          const pct = total > 0 ? Math.round((tokens / total) * 100) : 0;
          return (
            <div key={cat.key} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${cat.color} inline-block`} />
                <span>{cat.label}</span>
              </div>
              <span className="font-mono text-base-content/70">
                {tokens.toLocaleString()} <span className="text-base-content/40">({pct}%)</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Cacheable indicator */}
      <div className="border-t border-base-300 pt-2" data-testid="context-stats-cacheable">
        <div className="flex items-center justify-between">
          <span>Cacheable</span>
          <span className="font-mono text-base-content/70">
            {cacheable.toLocaleString()} tokens
            <span className="text-base-content/40">
              {' '}({total > 0 ? Math.round((cacheable / total) * 100) : 0}%)
            </span>
          </span>
        </div>
        <p className="text-base-content/40 mt-0.5 leading-tight">
          system + tools + skills (unchanged between turns)
        </p>
      </div>

      {/* System prompt */}
      {systemPrompt && (
        <div className="border-t border-base-300 pt-2 mt-2" data-testid="context-stats-system-prompt">
          <button
            className="flex items-center gap-1.5 w-full text-left text-base-content/60 hover:text-base-content/80 transition-colors"
            onClick={() => setPromptOpen((v) => !v)}
          >
            <span>📜 System Prompt</span>
            <ChevronDown size={11} className={`ml-auto transition-transform duration-150 ${promptOpen ? 'rotate-180' : ''}`} />
          </button>
          {promptOpen && (
            <div className="mt-1.5 bg-base-300/60 rounded px-2 py-1.5 text-[10px] font-mono text-base-content/60 whitespace-pre-wrap max-h-48 overflow-y-auto">
              {systemPrompt}
            </div>
          )}
        </div>
      )}

      {/* Available tools */}
      {activeToolNames && activeToolNames.length > 0 && (
        <div className="border-t border-base-300 pt-2 mt-2" data-testid="context-stats-tools">
          <button
            className="flex items-center gap-1.5 w-full text-left text-base-content/60 hover:text-base-content/80 transition-colors"
            onClick={() => setToolsOpen((v) => !v)}
          >
            <span>🔧 Tools ({activeToolNames.length})</span>
            <ChevronDown size={11} className={`ml-auto transition-transform duration-150 ${toolsOpen ? 'rotate-180' : ''}`} />
          </button>
          {toolsOpen && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {activeToolNames.map((name) => (
                <span key={name} className="font-mono text-[10px] bg-base-300/60 rounded px-1.5 py-0.5 text-sky-400/80">{name}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {(contextPreview || contextPreviewStatus) && (
        <div className="border-t border-base-300 pt-2 mt-2">
          <button
            type="button"
            className="flex items-center gap-1.5 w-full text-left text-base-content/60 hover:text-base-content/80 transition-colors"
            onClick={() => setRawOpen((value) => !value)}
          >
            <span>LLM payload preview</span>
            <ChevronDown size={11} className={`ml-auto transition-transform duration-150 ${rawOpen ? 'rotate-180' : ''}`} />
          </button>
          {rawOpen && (
            <div
              data-testid="context-preview-panel"
              className="mt-1.5 max-h-72 overflow-y-auto rounded bg-base-300/60 px-2 py-1.5 text-[10px] text-base-content/70"
            >
              {contextPreviewStatus?.loading && !contextPreview && <p>Loading backend preview...</p>}
              {contextPreviewStatus?.stale && <p className="text-warning">stale preview; refreshing...</p>}
              {contextPreviewStatus?.error && <p className="text-error">{contextPreviewStatus.error}</p>}
              {contextPreview && (
                <div className="space-y-2">
                  <section>
                    <div className="mb-1 font-semibold text-base-content/80">Effective system prompt</div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-base-content/65">{contextPreview.effectiveSystemPrompt}</pre>
                  </section>
                  <section>
                    <div className="mb-1 font-semibold text-base-content/80">Messages sent to model</div>
                    <div className="space-y-1">
                      {contextPreview.messages.map((message, index) => (
                        <div key={`${message.role}-${index}`} className="rounded bg-base-200/70 px-1.5 py-1">
                          <div className="mb-0.5 flex items-center justify-between gap-2 font-mono text-base-content/50">
                            <span>{index + 1}. {message.role} / {message.source}</span>
                            <span>{message.estimatedTokens} tokens</span>
                          </div>
                          {message.reasoningContent && (
                            <pre className="mb-1 whitespace-pre-wrap break-words font-mono text-warning/80">{message.reasoningContent}</pre>
                          )}
                          {message.toolCallId && (
                            <pre className="mb-1 whitespace-pre-wrap break-words font-mono text-info/80">{message.toolCallId}</pre>
                          )}
                          {message.toolCalls && message.toolCalls.length > 0 && (
                            <pre className="mb-1 whitespace-pre-wrap break-words font-mono text-info/80">{valueToPreviewText(message.toolCalls)}</pre>
                          )}
                          <pre className="whitespace-pre-wrap break-words font-mono">{contentToPreviewText(message.content)}</pre>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section>
                    <div className="mb-1 font-semibold text-base-content/80">Tools sent to model</div>
                    <div className="flex flex-wrap gap-1">
                      {contextPreview.tools.map((tool) => (
                        <span key={tool.name} className="rounded bg-base-200 px-1.5 py-0.5 font-mono">{tool.name}</span>
                      ))}
                      {contextPreview.tools.length === 0 && <span className="text-base-content/45">none</span>}
                    </div>
                  </section>
                  <section>
                    <div className="mb-1 font-semibold text-base-content/80">Compaction</div>
                    <div className="font-mono">
                      {contextPreview.compaction.applied ? 'applied' : 'not applied'} · {' '}
                      {contextPreview.compaction.unboundedMessageCount} -&gt; {contextPreview.compaction.finalMessageCount} · target {contextPreview.compaction.safeTargetTokens}
                    </div>
                  </section>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
