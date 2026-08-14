import type { TalkGrouping } from '../../App.types';

export interface ProjectHistorySwitcherProps {
  value: TalkGrouping;
  onChange: (value: TalkGrouping) => void;
}

export function ProjectHistorySwitcher({ value, onChange }: ProjectHistorySwitcherProps) {
  return (
    <div className="inline-flex rounded-md border border-base-300 bg-base-200/60 p-0.5" role="group" aria-label="Grupowanie rozmów" data-testid="talk-grouping-switcher">
      {(['project', 'history'] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={`rounded px-2 py-1 text-[10px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${value === option ? 'bg-sky-500/15 text-sky-300' : 'text-base-content/50 hover:text-base-content/80'}`}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          data-testid={`talk-grouping-${option}`}
        >
          {option === 'project' ? 'Projekt' : 'Historia'}
        </button>
      ))}
    </div>
  );
}
