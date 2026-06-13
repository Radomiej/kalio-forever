import type { PointerEvent as ReactPointerEvent } from 'react';
import type { GraphPanStart, GraphViewportPoint } from '../useGraphInteraction';

export type { GraphPanStart };

export type GraphPointerCaptureTarget = Element;

export type GraphViewportAdapter = {
  pan: GraphViewportPoint;
  setPan: (next: GraphViewportPoint | ((current: GraphViewportPoint) => GraphViewportPoint)) => void;
  zoom: number;
  clientToWorld?: (bounds: DOMRect, clientX: number, clientY: number) => GraphViewportPoint;
  clampPan?: (next: GraphViewportPoint) => GraphViewportPoint;
};

export type GraphPanControllerOptions = {
  pan: GraphViewportPoint;
  setPan: GraphViewportAdapter['setPan'];
  spacePanning: boolean;
  blockedSelector: string;
  clampPan?: (next: GraphViewportPoint) => GraphViewportPoint;
  useMouseFallback?: boolean;
  resolveForcePan?: (event: { altKey: boolean; button: number }) => boolean;
};

export type GraphNodeDragState = {
  nodeId: string;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

export type GraphNodeDragAdapter<TNode> = {
  getNodeOrigin: (node: TNode) => GraphViewportPoint;
  commitPosition: (nodeId: string, position: GraphViewportPoint) => void;
  canStartDrag?: (event: ReactPointerEvent<HTMLElement>, node: TNode) => boolean;
  onSelectOnStart?: (nodeId: string) => void;
};

export type GraphNodeDragControllerOptions<TNode> = {
  zoom: number;
  spacePanning: boolean;
  adapter: GraphNodeDragAdapter<TNode>;
};

export type GraphConnectorDragState = {
  sourceNodeId: string;
  direction?: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  previewPoint?: GraphViewportPoint;
  targetNodeId?: string | null;
};

export type GraphConnectorDragAdapter<TState extends { sourceNodeId: string; direction?: string }> = {
  resolveDropTarget: (clientX: number, clientY: number, state: TState) => string | null;
  onPreview?: (point: GraphViewportPoint, targetNodeId: string | null) => void;
  onCommit: (sourceNodeId: string, targetNodeId: string | null, moved: boolean) => void;
  applyAutoPan: (clientX: number, clientY: number) => void;
  canStart?: (event: ReactPointerEvent<HTMLElement>) => boolean;
  clientToPreviewPoint: (clientX: number, clientY: number) => GraphViewportPoint | null;
  getAutoPanBounds: () => Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'> | null;
};

export type GraphConnectorDragControllerOptions<TState extends {
  sourceNodeId: string;
  direction?: string;
  moved: boolean;
  pointerId: number;
  startX: number;
  startY: number;
}> = {
  adapter: GraphConnectorDragAdapter<TState>;
  createDragState: (
    event: ReactPointerEvent<HTMLElement>,
    meta: Omit<TState, 'moved' | 'pointerId' | 'startX' | 'startY'>,
  ) => TState;
};

export type GraphResetScope = 'identity' | 'viewport' | 'interaction-only';

export type GraphBoundsAdapter = {
  fitViewport: (nodes: unknown[], viewport: { width: number; height: number }) => { pan: GraphViewportPoint; zoom: number };
};
