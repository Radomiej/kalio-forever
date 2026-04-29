import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toFriendlyName } from '../../utils/friendlyId';

interface FriendlyIdProps {
  /** The raw opaque ID to translate. */
  id: string;
  /**
   * What kind of ID this is, e.g. "Session", "Msg". Shown as a dim prefix
   * label and included in the tooltip so the user knows what they're looking at.
   */
  context?: string;
  /**
   * Human-readable title for the entity the ID belongs to (e.g. a session
   * title). When provided, displayed instead of the hash alias.
   */
  resolvedTitle?: string;
  className?: string;
}

/** Returns the tooltip string shown on hover. */
function buildTooltip(id: string, context?: string, resolvedTitle?: string): string {
  const parts: string[] = [];
  if (context) parts.push(`${context} ID`);
  if (resolvedTitle) parts.push(`"${resolvedTitle}"`);
  parts.push(id);
  return parts.join(' · ');
}

/**
 * Renders a human-readable alias for an opaque ID.
 * - Hover shows a tooltip with context label + real ID
 * - Click copies the real ID to clipboard
 */
export function FriendlyId({ id, context, resolvedTitle, className = '' }: FriendlyIdProps) {
  const [copied, setCopied] = useState(false);
  const displayName = resolvedTitle
    ? resolvedTitle.length > 18 ? resolvedTitle.slice(0, 17) + '…' : resolvedTitle
    : toFriendlyName(id);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const tooltip = copied ? '✓ copied!' : buildTooltip(id, context, resolvedTitle);

  return (
    <span
      className={`tooltip tooltip-bottom cursor-pointer select-none ${className}`}
      data-tip={tooltip}
      onClick={handleClick}
      data-testid="friendly-id"
      aria-label={`${displayName} (click to copy ID)`}
    >
      {copied ? (
        <span className="flex items-center gap-0.5 text-success font-mono text-[10px]">
          <Check size={9} />
          copied!
        </span>
      ) : (
        <span className="flex items-center gap-1 font-mono text-[10px] text-base-content/30 hover:text-base-content/60 transition-colors">
          {context && (
            <span className="text-[8px] uppercase tracking-wide text-base-content/20 font-sans font-semibold">
              {context}
            </span>
          )}
          <span>{displayName}</span>
          <Copy size={8} className="opacity-0 group-hover:opacity-40" />
        </span>
      )}
    </span>
  );
}
