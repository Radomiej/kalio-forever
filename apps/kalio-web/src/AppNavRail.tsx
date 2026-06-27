import type { ReactNode } from 'react';
import { Activity, BrainCircuit, MessageSquare, Network, Settings, Wrench } from 'lucide-react';
import type { ActiveSection } from './App.types';

const NAV: { id: ActiveSection; icon: ReactNode; label: string }[] = [
  { id: 'talk', icon: <MessageSquare size={18} />, label: 'Talk' },
  { id: 'tools', icon: <Wrench size={18} />, label: 'Tools' },
  { id: 'mind', icon: <BrainCircuit size={18} />, label: 'Mind' },
  { id: 'architect', icon: <Network size={18} />, label: 'Architect' },
  { id: 'observe', icon: <Activity size={18} />, label: 'Observability' },
];

export function AppNavRail({
  activeSection,
  talkAttentionCount,
  talkAttentionTitle,
  recentTalkCount,
  onGoHome,
  onOpenSettings,
  onSelectSection,
}: {
  activeSection: ActiveSection;
  talkAttentionCount: number;
  talkAttentionTitle: string;
  recentTalkCount: number;
  onGoHome: () => void;
  onOpenSettings: () => void;
  onSelectSection: (section: ActiveSection) => void;
}) {
  return (
    <nav className="w-14 shrink-0 flex flex-col items-center py-3 gap-1 border-r border-base-300 bg-base-200 z-10">
      <button
        className={`mb-1 btn btn-ghost btn-sm w-10 h-10 p-0 flex items-center justify-center ${
          activeSection === 'landing'
            ? 'bg-sky-500/15 text-sky-400 border-l-2 border-sky-500'
            : ''
        }`}
        onClick={onGoHome}
        data-testid="nav-home"
        aria-label="Home"
        title="Home"
      >
        <span className={`font-black text-lg select-none ${
          activeSection === 'landing'
            ? 'text-sky-400 drop-shadow-[0_0_10px_oklch(0.60_0.176_232.6/0.9)]'
            : 'text-primary drop-shadow-[0_0_8px_oklch(0.60_0.176_232.6/0.7)]'
        }`}>K</span>
      </button>

      <div className="w-8 border-b border-base-300 my-1" />

      {NAV.map((item) => (
        <div key={item.id} className="relative">
          <button
            className={`btn btn-ghost btn-sm w-10 h-10 p-0 flex flex-col items-center justify-center tooltip tooltip-right ${
              activeSection === item.id && activeSection !== 'landing'
                ? 'bg-sky-500/15 text-sky-400 border-l-2 border-sky-500'
                : 'text-base-content/60 hover:text-base-content/90'
            }`}
            data-tip={item.label}
            onClick={() => onSelectSection(item.id)}
            data-testid={`nav-${item.id}`}
            aria-label={item.label}
            title={item.label}
          >
            {item.icon}
          </button>
          {item.id === 'talk' && activeSection !== 'talk' && (talkAttentionCount > 0 || recentTalkCount > 0) && (
            <span
              className={`absolute -top-1 -right-1 badge badge-xs pointer-events-none ${
                talkAttentionCount > 0
                  ? 'badge-warning animate-pulse'
                  : 'badge-info'
              }`}
              title={talkAttentionCount > 0
                ? talkAttentionTitle
                : `${recentTalkCount} completed or updated chat${recentTalkCount === 1 ? '' : 's'} since last Talk activity`}
              aria-label={talkAttentionCount > 0
                ? talkAttentionTitle
                : `${recentTalkCount} completed or updated chat${recentTalkCount === 1 ? '' : 's'} since last Talk activity`}
              data-testid="nav-talk-activity-count"
            >
              {(talkAttentionCount > 0 ? talkAttentionCount : recentTalkCount) > 99
                ? '99+'
                : talkAttentionCount > 0 ? talkAttentionCount : recentTalkCount}
            </span>
          )}
        </div>
      ))}

      <div className="flex-1" />

      <div className="mb-2 relative">
        <button
          className="btn btn-ghost btn-sm w-10 h-10 p-0 flex items-center justify-center tooltip tooltip-right text-base-content/60 hover:text-primary"
          data-tip="Settings"
          onClick={onOpenSettings}
          data-testid="nav-settings"
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={18} />
        </button>
      </div>
    </nav>
  );
}
