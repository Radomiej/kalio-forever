import { Wrench, Zap } from 'lucide-react';
import type { ToolActivity } from '../../../store/agentStore';
import type { GraphCardDensity } from './ExecutionGraphBoard.types';
import type { ExecutionGraphFocusMode } from './executionGraphFocus';
import type { ExecutionGraphHydrationStatus } from './executionGraphHydration';

interface ExecutionGraphHeaderProps {
  cardDensity: GraphCardDensity;
  collapseTools: boolean;
  focusMode: ExecutionGraphFocusMode;
  hydrationStatus: ExecutionGraphHydrationStatus | null;
  onCardDensityChange: (density: GraphCardDensity) => void;
  onDecreaseZoom: () => void;
  onFocusModeChange: (mode: ExecutionGraphFocusMode) => void;
  onIncreaseZoom: () => void;
  onResetZoom: () => void;
  runningLoops: Array<{ sessionId: string; turnId: string; agentRun?: { label?: string } }>;
  runningToolActivities: ToolActivity[];
  sessionTitleById: Map<string, string>;
  showFocusToggle: boolean;
  zoom: number;
}

function formatLoopLabel(
  loop: { sessionId: string; agentRun?: { label?: string } },
  sessionTitleById: Map<string, string>,
): string {
  return loop.agentRun?.label ?? sessionTitleById.get(loop.sessionId) ?? 'Agent run';
}

function hydrationToneClass(status: ExecutionGraphHydrationStatus | null): string {
  if (status?.tone === 'success') {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200';
  }
  if (status?.tone === 'warning') {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-200';
  }
  return 'border-base-300 text-base-content/45';
}

export function ExecutionGraphHeader({
  cardDensity,
  collapseTools,
  focusMode,
  hydrationStatus,
  onCardDensityChange,
  onDecreaseZoom,
  onFocusModeChange,
  onIncreaseZoom,
  onResetZoom,
  runningLoops,
  runningToolActivities,
  sessionTitleById,
  showFocusToggle,
  zoom,
}: ExecutionGraphHeaderProps) {
  return (
    <>
      <div className="px-3 py-2 border-b border-base-300 bg-base-100 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Execution Graph</h2>
          <p className="hidden text-xs text-base-content/45 md:block">Prompts, turns, tools, subagents, artifacts and final responses.</p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 justify-end">
          <button
            type="button"
            data-testid="graph-zoom-out"
            className="min-h-7 min-w-7 rounded-md border border-base-300 px-2 text-xs text-base-content/75 transition-colors hover:text-base-content"
            onClick={onDecreaseZoom}
          >
            -
          </button>
          <span className="rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-sky-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            data-testid="graph-zoom-in"
            className="min-h-7 min-w-7 rounded-md border border-base-300 px-2 text-xs text-base-content/75 transition-colors hover:text-base-content"
            onClick={onIncreaseZoom}
          >
            +
          </button>
          <button
            type="button"
            data-testid="graph-zoom-reset"
            className="min-h-7 rounded-md border border-base-300 px-2 text-xs text-base-content/75 transition-colors hover:text-base-content"
            onClick={onResetZoom}
          >
            Reset
          </button>
          <span className={`rounded-md border px-2 py-1 text-[11px] uppercase tracking-[0.12em] ${collapseTools ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-base-300 text-base-content/45'}`}>
            {collapseTools ? 'tools grouped' : 'tools expanded'}
          </span>
          <div className="inline-flex rounded-md border border-base-300 bg-base-200/40 p-0.5" aria-label="Graph card density">
            {[
              { id: 'compact' as const, label: 'Compact' },
              { id: 'detailed' as const, label: 'Detailed' },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                data-testid={`graph-card-density-${option.id}`}
                className={`min-h-6 rounded px-2 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                  cardDensity === option.id
                    ? 'bg-cyan-500/20 text-cyan-200'
                    : 'text-base-content/45 hover:text-base-content/80'
                }`}
                onClick={() => onCardDensityChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="rounded-md border border-base-300 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-base-content/45">
            pan / wheel
          </span>
          <span className="rounded-md border border-base-300 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-base-content/45">
            {runningLoops.length} agent{runningLoops.length === 1 ? '' : 's'} live
          </span>
          <span className="rounded-md border border-base-300 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-base-content/45">
            {runningToolActivities.length} tool{runningToolActivities.length === 1 ? '' : 's'} active
          </span>
          {hydrationStatus && (
            <span
              className={`rounded-md border px-2 py-1 text-[11px] uppercase tracking-[0.12em] ${hydrationToneClass(hydrationStatus)}`}
              title={hydrationStatus.detail}
            >
              {hydrationStatus.label}
            </span>
          )}
          {showFocusToggle && (
            <div className="inline-flex rounded-md border border-base-300 bg-base-200/40 p-0.5" aria-label="Graph run scope">
              {[
                { id: 'latest-architecture' as const, label: 'Latest run' },
                { id: 'all' as const, label: 'All' },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  data-testid={`graph-focus-${option.id}`}
                  className={`min-h-6 rounded px-2 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                    focusMode === option.id
                      ? 'bg-sky-500/20 text-sky-200'
                      : 'text-base-content/45 hover:text-base-content/80'
                  }`}
                  onClick={() => onFocusModeChange(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {(runningLoops.length > 0 || runningToolActivities.length > 0) && (
        <div className="px-3 py-2 border-b border-base-300 bg-base-200/30 flex flex-wrap items-center gap-1.5 shrink-0">
          {runningLoops.map((loop) => (
            <div
              key={`${loop.sessionId}-${loop.turnId}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-xs text-sky-300"
            >
              <Zap size={12} className="shrink-0" />
              <span>{formatLoopLabel(loop, sessionTitleById)}</span>
            </div>
          ))}
          {runningToolActivities.slice(0, 4).map((activity) => (
            <div
              key={activity.callId}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs text-amber-200"
            >
              <Wrench size={12} className="shrink-0" />
              <span>{activity.toolName}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
