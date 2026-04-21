import { X, Minimize2 } from 'lucide-react';
import { formatTokenCount, type TokenCount } from '../../services/tokenCounter';

interface ContextStatsProps {
  tokenCount: TokenCount;
  onCompactNow?: () => void;
  onClose: () => void;
}

// ── Category config ────────────────────────────────────────────────────────────

interface CategoryDef {
  key: keyof TokenCount['breakdown'];
  label: string;
  icon: string;
  color: string; // Tailwind bg class
  barColor: string; // For the stacked bar
}

const CATEGORIES: CategoryDef[] = [
  { key: 'tools', label: 'Tools definition', icon: '🔧', color: 'bg-info', barColor: 'bg-info' },
  { key: 'systemPrompt', label: 'System prompt', icon: '📜', color: 'bg-secondary', barColor: 'bg-secondary' },
  { key: 'skills', label: 'Skills', icon: '⚡', color: 'bg-warning', barColor: 'bg-warning' },
  { key: 'history', label: 'History', icon: '💬', color: 'bg-success', barColor: 'bg-success' },
  { key: 'images', label: 'Images', icon: '🖼️', color: 'bg-accent', barColor: 'bg-accent' },
];

// ── Component ──────────────────────────────────────────────────────────────────

export function ContextStats({ tokenCount, onCompactNow, onClose }: ContextStatsProps) {
  const { total, breakdown, cacheable, contextLimit, usagePercent } = tokenCount;

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
        <span className="font-semibold text-sm">Context Usage</span>
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
                <span>{cat.icon} {cat.label}</span>
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
          <span>💾 Cacheable</span>
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
    </div>
  );
}
