import type { ArchitectureNodeKind } from '@kalio/types';
import { Bot, Box, GitBranch, LayoutTemplate, LocateFixed, Merge, Minus, MousePointer2, Plus, Route } from 'lucide-react';

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
  return (
    <div className="absolute left-3 top-3 flex items-center gap-0.5 rounded-md border border-base-300 bg-base-100/90 p-1 shadow-lg backdrop-blur">
      <button
        type="button"
        className={`btn btn-xs btn-square h-7 min-h-7 w-7 ${editMode === 'select' ? 'btn-info' : 'btn-ghost'}`}
        onClick={() => onModeChange('select')}
        data-testid="architect-mode-select"
        title="Select and move nodes"
      >
        <MousePointer2 size={12} />
      </button>
      <button
        type="button"
        className={`btn btn-xs btn-square h-7 min-h-7 w-7 ${editMode === 'connect' ? 'btn-info' : 'btn-ghost'}`}
        onClick={() => onModeChange('connect')}
        data-testid="architect-mode-connect"
        title="Connect or disconnect nodes"
      >
        <Merge size={12} />
      </button>
      <div className="mx-1 h-4 w-px bg-base-300" />
      {PALETTE.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.kind}
            type="button"
            className={`btn btn-xs h-7 min-h-7 gap-1 px-2 text-[11px] ${editMode === 'add' && addNodeKind === item.kind ? 'btn-info' : 'btn-ghost'}`}
            onClick={() => onModeChange('add', item.kind)}
            data-testid={item.kind === 'role' ? 'architect-mode-add-node' : `architect-mode-add-${item.kind}`}
            title={item.title}
          >
            <Icon size={12} />
            <span className="hidden 2xl:inline">{item.label}</span>
          </button>
        );
      })}
      <div className="mx-1 h-4 w-px bg-base-300" />
      <button type="button" className="btn btn-ghost btn-xs btn-square h-7 min-h-7 w-7" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out">
        <Minus size={12} />
      </button>
      <div className="min-w-10 text-center font-mono text-[10px] text-base-content/55" data-testid="architect-zoom-label">
        {Math.round(zoom * 100)}%
      </div>
      <button type="button" className="btn btn-ghost btn-xs btn-square h-7 min-h-7 w-7" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">
        <Plus size={12} />
      </button>
      <button type="button" className="btn btn-ghost btn-xs btn-square h-7 min-h-7 w-7" onClick={onResetViewport} aria-label="Reset viewport" title="Reset viewport">
        <LocateFixed size={12} />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-xs h-7 min-h-7 gap-1 px-2 text-[11px]"
        onClick={onAutoLayout}
        data-testid="architect-auto-layout"
        title="Auto-layout graph"
      >
        <LayoutTemplate size={12} />
        <span className="hidden 2xl:inline">Layout</span>
      </button>
    </div>
  );
}
