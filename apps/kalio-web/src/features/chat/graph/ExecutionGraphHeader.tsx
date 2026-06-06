import { Maximize2, MoreHorizontal, RefreshCw, Wrench, ZoomIn, ZoomOut, Zap } from 'lucide-react';
import { useState } from 'react';
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
  onFitAll: () => void;
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
  onFitAll,
  onFocusModeChange,
  onIncreaseZoom,
  onResetZoom,
  runningLoops,
  runningToolActivities,
  sessionTitleById,
  showFocusToggle,
  zoom,
}: ExecutionGraphHeaderProps) {
  const [controlsMenuOpen, setControlsMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const closeControlsMenu = () => setControlsMenuOpen(false);

  const handleCardDensityChange = (density: GraphCardDensity) => {
    onCardDensityChange(density);
    closeControlsMenu();
  };

  const handleFocusModeChange = (mode: ExecutionGraphFocusMode) => {
    onFocusModeChange(mode);
    closeControlsMenu();
  };

  const handleResetZoom = () => {
    onResetZoom();
    closeControlsMenu();
  };
  const handleFitAll = () => {
    onFitAll();
    closeControlsMenu();
  };

  const statusSummary = [
    `${runningLoops.length} agent${runningLoops.length === 1 ? '' : 's'}`,
    `${runningToolActivities.length} tool${runningToolActivities.length === 1 ? '' : 's'}`,
  ].join(' / ');

  return (
    <>
      <div className="px-3 py-2 border-b border-base-300 bg-base-100 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Execution Graph</h2>
        </div>

        <div className="relative flex flex-wrap items-center gap-1.5 justify-end">
          <button
            type="button"
            data-testid="graph-zoom-out"
            aria-label="Zoom out"
            title="Zoom out"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-base-300 text-base-content/75 transition-colors hover:text-base-content"
            onClick={onDecreaseZoom}
          >
            <ZoomOut size={14} />
          </button>
          <span className="rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-sky-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            data-testid="graph-zoom-in"
            aria-label="Zoom in"
            title="Zoom in"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-base-300 text-base-content/75 transition-colors hover:text-base-content"
            onClick={onIncreaseZoom}
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            aria-label="More graph controls"
            title="More graph controls"
            aria-expanded={controlsMenuOpen}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-base-300 text-base-content/75 transition-colors hover:text-base-content"
            onClick={() => setControlsMenuOpen((value) => !value)}
          >
            <MoreHorizontal size={14} />
          </button>
          {controlsMenuOpen && (
            <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-lg border border-base-300 bg-base-100 p-3 shadow-[0_12px_28px_rgba(2,12,27,0.18)]">
              <div className="space-y-3">
                <button
                  type="button"
                  data-testid="graph-zoom-reset"
                  className="flex w-full items-center gap-2 rounded-md border border-base-300 bg-base-200/40 px-3 py-2 text-left text-xs text-base-content/75 transition-colors hover:text-base-content"
                  onClick={handleResetZoom}
                >
                  <RefreshCw size={13} className="shrink-0" />
                  <span>Reset zoom</span>
                </button>
                <button
                  type="button"
                  data-testid="graph-fit-all"
                  className="flex w-full items-center gap-2 rounded-md border border-base-300 bg-base-200/40 px-3 py-2 text-left text-xs text-base-content/75 transition-colors hover:text-base-content"
                  onClick={handleFitAll}
                >
                  <Maximize2 size={13} className="shrink-0" />
                  <span>Fit all</span>
                </button>

                <section className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-base-content/35">Card density</p>
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
                        onClick={() => handleCardDensityChange(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </section>

                {showFocusToggle && (
                  <section className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-base-content/35">Run scope</p>
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
                          onClick={() => handleFocusModeChange(option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                <section className="space-y-1.5">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-base-300 bg-base-200/40 px-3 py-2 text-left text-xs text-base-content/70 transition-colors hover:text-base-content"
                    aria-expanded={helpOpen}
                    onClick={() => setHelpOpen((value) => !value)}
                  >
                    <span className="shrink-0">Input help</span>
                    <span className="truncate text-[10px] uppercase tracking-[0.12em] text-base-content/40">{statusSummary}</span>
                  </button>
                  {helpOpen && (
                    <div className="space-y-2" data-testid="graph-help-disclosure">
                      <div className="grid gap-1.5 text-[11px] text-base-content/65" data-testid="graph-gesture-hints">
                        <span className="rounded-md border border-base-300 px-2 py-1">
                          Drag empty canvas, middle-drag, or hold Space over nodes to pan.
                        </span>
                        <span className="rounded-md border border-base-300 px-2 py-1">
                          Drag node body to reposition it. Connector dots inspect flow endpoints.
                        </span>
                        <span className="rounded-md border border-base-300 px-2 py-1">
                          Wheel zoom keeps the cursor point anchored.
                        </span>
                      </div>
                      <div className="grid gap-1.5 text-[11px] text-base-content/55">
                        <span className={`rounded-md border px-2 py-1 uppercase tracking-[0.12em] ${collapseTools ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-base-300 text-base-content/45'}`}>
                          {collapseTools ? 'tools grouped' : 'tools expanded'}
                        </span>
                        <span className="rounded-md border border-base-300 px-2 py-1 uppercase tracking-[0.12em] text-base-content/45">
                          pan / wheel
                        </span>
                        <span className="rounded-md border border-base-300 px-2 py-1 uppercase tracking-[0.12em] text-base-content/45">
                          {runningLoops.length} agent{runningLoops.length === 1 ? '' : 's'} live
                        </span>
                        <span className="rounded-md border border-base-300 px-2 py-1 uppercase tracking-[0.12em] text-base-content/45">
                          {runningToolActivities.length} tool{runningToolActivities.length === 1 ? '' : 's'} active
                        </span>
                        {hydrationStatus && (
                          <span
                            className={`rounded-md border px-2 py-1 uppercase tracking-[0.12em] ${hydrationToneClass(hydrationStatus)}`}
                            title={hydrationStatus.detail}
                          >
                            {hydrationStatus.label}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              </div>
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
