import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toFriendlyName } from '../../utils/friendlyId';

interface FriendlyIdProps {
  /** The raw opaque ID to translate. */
  id: string;
  className?: string;
}

/**
 * Renders a human-readable alias for an opaque ID.
 * - Hover shows the real ID in a tooltip
 * - Click copies the real ID to clipboard
 */
export function FriendlyId({ id, className = '' }: FriendlyIdProps) {
  const [copied, setCopied] = useState(false);
  const name = toFriendlyName(id);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <span
      className={`tooltip tooltip-bottom cursor-pointer select-none ${className}`}
      data-tip={copied ? '✓ copied!' : id}
      onClick={handleClick}
      data-testid="friendly-id"
      aria-label={`${name} (click to copy ID)`}
    >
      {copied ? (
        <span className="flex items-center gap-0.5 text-success font-mono text-[10px]">
          <Check size={9} />
          copied!
        </span>
      ) : (
        <span className="flex items-center gap-0.5 font-mono text-[10px] text-base-content/30 hover:text-base-content/60 transition-colors">
          {name}
          <Copy size={8} className="opacity-0 group-hover:opacity-40" />
        </span>
      )}
    </span>
  );
}
