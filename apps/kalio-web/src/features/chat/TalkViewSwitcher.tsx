import { GitBranch, MessageSquare } from 'lucide-react';
import type { TalkView } from '../../App.types';

export interface TalkViewSwitcherProps {
  value: TalkView;
  onChange: (value: TalkView) => void;
  compact?: boolean;
}

const OPTIONS = [
  { value: 'conversation' as const, label: 'Chat', icon: MessageSquare },
  { value: 'graph' as const, label: 'Graf', icon: GitBranch },
];

export function TalkViewSwitcher({ value, onChange, compact = false }: TalkViewSwitcherProps) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-base-200/70 p-0.5" role="group" aria-label="Widok konwersacji" data-testid="talk-view-switcher">
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${value === option.value ? 'bg-primary/15 text-primary' : 'text-base-content/55 hover:text-base-content/85'}`}
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            data-testid={`talk-${option.value}-switcher`}
            title={option.label}
          >
            <Icon size={compact ? 13 : 14} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
