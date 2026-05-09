import { formatTokenCount, type TokenCount } from '../../services/tokenCounter';

interface TokenBadgeProps {
  tokenCount: TokenCount;
  onClick?: () => void;
}

export function TokenBadge({ tokenCount, onClick }: TokenBadgeProps) {
  const { total, contextLimit, usagePercent } = tokenCount;

  const badgeColor =
    usagePercent >= 95
      ? 'badge-error'
      : usagePercent >= 80
        ? 'badge-warning'
        : 'badge-ghost';

  return (
    <button
      type="button"
      className={`badge badge-sm ${badgeColor} font-mono text-[10px] shrink-0 cursor-pointer hover:opacity-80 transition-opacity`}
      onClick={onClick}
      title={`Context usage: ~${total.toLocaleString()} / ${contextLimit.toLocaleString()} tokens (${usagePercent}%)`}
      data-testid="token-badge"
    >
      ~{formatTokenCount(total)}/{formatTokenCount(contextLimit)}
    </button>
  );
}
