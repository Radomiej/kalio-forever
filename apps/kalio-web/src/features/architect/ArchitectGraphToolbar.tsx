import type { ArchitectureNodeKind } from '@kalio/types';
import { Bot, Box, GitBranch, HelpCircle, LayoutTemplate, LocateFixed, Merge, Minus, MoreHorizontal, MousePointer2, Plus, Route } from 'lucide-react';
import { useState } from 'react';

type EditMode = 'select' | 'add' | 'connect';

interface ArchitectGraphToolbarProps {
  editMode: EditMode;
  addNodeKind: ArchitectureNodeKind;
  zoom: number;
  onModeChange: (mode: EditMode, kind?: ArchitectureNodeKind) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetViewport: () => void;
  onAutoLayout: () => void;
}

const PALETTE: ReadonlyArray<{
  kind: ArchitectureNodeKind;
  label: string;
  title: string;
  icon: typeof Bot;
}> = [
  { kind: 'role', label: 'Agent', title: 'Add agent node', icon: Bot },
  { kind: 'router', label: 'Router', title: 'Add router node', icon: Route },
  { kind: 'parallel', label: 'Parallel', title: 'Add parallel router node', icon: GitBranch },
  { kind: 'artifact', label: 'Artifact', title: 'Add final artifact node', icon: Box },
];

export function ArchitectGraphToolbar({
  editMode,
  addNodeKind,
  zoom,
  onModeChange,
  onZoomIn,
  onZoomOut,
  onResetViewport,
  onAutoLayout,
}: ArchitectGraphToolbarProps) {
  const [controlsOpen, setControlsOpen] = useState(false);

  const closeControls = () => setControlsOpen(false);

  const chooseAddMode = (kind: ArchitectureNodeKind) => {
    onModeChange('add', kind);
    closeControls();
  };

  return (
    <div
      className="absolute left-3 top-3 flex items-center gap-0.5 rounded-md border border-base-300 bg-base-100/90 p-1 shadow-lg backdrop-blur"
      data-architect-control="true"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={`btn btn-xs btn-square h-11 min-h-11 w-11 ${editMode === 'select' ? 'btn-info' : 'btn-ghost'}`}
        onClick={() => onModeChange('select')}
        aria-label="Select and move nodes"
        data-testid="architect-mode-select"
        title="Select and move nodes"
      >
        <MousePointer2 size={12} />
      </button>
      <button
        type="button"
        className={`btn btn-xs btn-square h-11 min-h-11 w-11 ${editMode === 'connect' ? 'btn-info' : 'btn-ghost'}`}
        onClick={() => onModeChange('connect')}
        aria-label="Connect or disconnect nodes"
        data-testid="architect-mode-connect"
        title="Connect or disconnect nodes"
      >
        <Merge size={12} />
      </button>
      <div className="mx-1 h-6 w-px bg-base-300" />
      <button type="button" className="btn btn-ghost btn-xs btn-square h-11 min-h-11 w-11" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out">
        <Minus size={12} />
      </button>
      <div className="min-w-10 text-center font-mono text-[10px] text-base-content/55" data-testid="architect-zoom-label">
        {Math.round(zoom * 100)}%
      </div>
      <button type="button" className="btn btn-ghost btn-xs btn-square h-11 min-h-11 w-11" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">
        <Plus size={12} />
      </button>
      <div className="relative">
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square h-11 min-h-11 w-11"
          aria-expanded={controlsOpen}
          aria-label="More graph controls"
          title="More graph controls"
          onClick={() => setControlsOpen((value) => !value)}
        >
          <MoreHorizontal size={12} />
        </button>
        {controlsOpen && (
          <div
            className="absolute left-0 top-full z-20 mt-2 w-72 rounded-md border border-base-300 bg-base-100 p-3 text-[11px] leading-5 text-base-content/70 shadow-[0_12px_28px_rgba(2,12,27,0.22)]"
            data-testid="architect-graph-controls-menu"
          >
            <section className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-base-content/45">Add node</p>
              <div className="grid grid-cols-2 gap-1">
                {PALETTE.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.kind}
                      type="button"
                      className={`btn btn-xs min-h-7 justify-start gap-1.5 px-2 text-[11px] ${editMode === 'add' && addNodeKind === item.kind ? 'btn-info' : 'btn-ghost'}`}
                      onClick={() => chooseAddMode(item.kind)}
                      data-testid={item.kind === 'role' ? 'architect-mode-add-node' : `architect-mode-add-${item.kind}`}
                      title={item.title}
                    >
                      <Icon size={12} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="mt-3 grid gap-1">
              <button
                type="button"
                className="btn btn-ghost btn-xs min-h-7 justify-start gap-2 px-2 text-[11px]"
                onClick={() => {
                  onAutoLayout();
                  closeControls();
                }}
                data-testid="architect-auto-layout"
                title="Auto-layout graph"
              >
                <LayoutTemplate size={12} />
                Layout graph
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs min-h-7 justify-start gap-2 px-2 text-[11px]"
                onClick={() => {
                  onResetViewport();
                  closeControls();
                }}
                aria-label="Reset viewport"
                title="Reset viewport"
              >
                <LocateFixed size={12} />
                Reset viewport
              </button>
            </section>

            <section className="mt-3 space-y-1.5">
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-base-content/45">
                <HelpCircle size={11} />
                Gestures
              </p>
              <div className="grid gap-1.5" data-testid="architect-gesture-guide">
                <span>Drag empty canvas or hold Space over nodes to pan.</span>
                <span>Drag the node icon handle to reposition a node.</span>
                <span>Drag from output dot to input dot, or click two connector dots, to toggle a connection.</span>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
