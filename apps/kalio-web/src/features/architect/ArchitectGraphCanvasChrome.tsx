import type { ArchitectureNodeKind } from '@kalio/types';
import { ArchitectGraphToolbar } from './ArchitectGraphToolbar';

type ArchitectEditMode = 'select' | 'add' | 'connect';

export function ArchitectGraphCanvasToolbar({
  addNodeKind,
  editMode,
  onAutoLayout,
  onModeChange,
  onResetViewport,
  onZoomIn,
  onZoomOut,
  runtimeMode,
  zoom,
}: {
  addNodeKind: ArchitectureNodeKind;
  editMode: ArchitectEditMode;
  onAutoLayout: () => void;
  onModeChange: (mode: ArchitectEditMode, kind?: ArchitectureNodeKind) => void;
  onResetViewport: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  runtimeMode: boolean;
  zoom: number;
}) {
  return (
    <ArchitectGraphToolbar
      editMode={runtimeMode ? 'select' : editMode}
      addNodeKind={addNodeKind}
      zoom={zoom}
      onModeChange={runtimeMode ? () => undefined : onModeChange}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onResetViewport={onResetViewport}
      onAutoLayout={runtimeMode ? () => undefined : onAutoLayout}
    />
  );
}

export function ArchitectRuntimeModeIndicator({ runtimeMode }: { runtimeMode: boolean }) {
  return (
    <div
      className={`absolute right-3 top-3 z-10 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
        runtimeMode
          ? 'border-sky-400/40 bg-sky-500/15 text-sky-100'
          : 'border-base-300/70 bg-base-100/80 text-base-content/45'
      }`}
      data-testid="architect-runtime-mode-indicator"
    >
      {runtimeMode ? 'Runtime preview' : 'Editor'}
    </div>
  );
}

export function ArchitectGraphEmptyState() {
  return (
    <section className="flex flex-1 items-center justify-center bg-[#080b12] text-sm text-base-content/40">
      No architecture schema loaded.
    </section>
  );
}
