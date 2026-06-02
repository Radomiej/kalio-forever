import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import type { ArchitectureGraphProjection, ArchitectureNodeKind } from '@kalio/types';
import type { ArchitectNode, ArchitectSchema } from './architect.types';
import { ArchitectGraphNodeCard } from './ArchitectGraphNodeCard';
import { ArchitectGraphToolbar } from './ArchitectGraphToolbar';
import { inputPin, outputPin } from './ArchitectGraphGeometry';

interface ArchitectGraphCanvasProps {
  schema: ArchitectSchema | null;
  selectedNodeId: string | null;
  selectedSlotId: string | null;
  onSelectNode: (nodeId: string) => void;
  onSelectSlot: (nodeId: string, slotId: string) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  onAddNode: (position: { x: number; y: number }, kind: ArchitectureNodeKind) => void;
  onToggleEdge: (fromNodeId: string, toNodeId: string) => void;
  onAutoLayout: () => void;
  routeHops?: ArchitectureGraphProjection['routeHops'];
  runtimeMode?: boolean;
}

const MIN_ZOOM = 0.65;
const MAX_ZOOM = 1.6;
const ZOOM_STEP = 0.1;
const DEFAULT_PAN = { x: 0, y: 0 };
const DEFAULT_ZOOM = 0.82;
const FREE_SPACE_WIDTH = 2800;
const FREE_SPACE_HEIGHT = 1800;
const MOUSE_FALLBACK_POINTER_ID = -1;
const EMPTY_NODES: ArchitectSchema['nodes'] = [];
const EMPTY_EDGES: ArchitectSchema['edges'] = [];

type EdgeKind = 'parallel' | 'routing' | 'forced';

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

function connectionPath(source: { x: number; y: number }, target: { x: number; y: number }): string {
  const dx = target.x - source.x;
  const tension = Math.max(48, Math.abs(dx) * 0.4);
  const controlDirection = dx >= 0 ? 1 : -1;
  const cx1 = source.x + tension * controlDirection;
  const cx2 = target.x - tension * controlDirection;
  return `M ${source.x} ${source.y} C ${cx1} ${source.y}, ${cx2} ${target.y}, ${target.x} ${target.y}`;
}

function edgeKind(sourceNode: ArchitectNode): EdgeKind {
  if (sourceNode.kind === 'parallel' || sourceNode.behavior?.mode === 'fan_out_all') {
    return 'parallel';
  }
  if (sourceNode.kind === 'router' || sourceNode.behavior?.mode === 'choose_one' || sourceNode.behavior?.mode === 'rank_then_merge') {
    return 'routing';
  }
  return 'forced';
}

function edgeClass(kind: EdgeKind, executed: boolean): string {
  if (executed) {
    return 'stroke-emerald-300/90 animate-pulse';
  }
  if (kind === 'parallel') {
    return 'stroke-violet-300/70';
  }
  if (kind === 'routing') {
    return 'stroke-amber-300/75';
  }
  return 'stroke-sky-500/55';
}

function edgeHaloClass(kind: EdgeKind, executed: boolean): string {
  if (executed) {
    return 'stroke-emerald-400/20';
  }
  if (kind === 'parallel') {
    return 'stroke-violet-400/16';
  }
  if (kind === 'routing') {
    return 'stroke-amber-400/18';
  }
  return 'stroke-sky-500/15';
}

function edgeDash(kind: EdgeKind): string | undefined {
  if (kind === 'routing') {
    return '7 5';
  }
  if (kind === 'parallel') {
    return '2 7';
  }
  return undefined;
}

function edgeWidth(kind: EdgeKind, executed: boolean): string {
  if (executed) {
    return '2.8';
  }
  if (kind === 'parallel') {
    return '2.2';
  }
  if (kind === 'routing') {
    return '2';
  }
  return '1.6';
}

function canStartPan(target: EventTarget, altKey: boolean, button: number): boolean {
  const element = target instanceof Element ? target : null;
  return !element?.closest('[data-architect-control="true"]') && (altKey || button === 1);
}

function hasPointerEvents(): boolean {
  return typeof window !== 'undefined' && 'PointerEvent' in window;
}

export function ArchitectGraphCanvas({
  schema,
  selectedNodeId,
  selectedSlotId,
  onSelectNode,
  onSelectSlot,
  onMoveNode,
  onAddNode,
  onToggleEdge,
  onAutoLayout,
  routeHops,
  runtimeMode = false,
}: ArchitectGraphCanvasProps) {
  const [editMode, setEditMode] = useState<'select' | 'add' | 'connect'>('select');
  const [addNodeKind, setAddNodeKind] = useState<ArchitectureNodeKind>('role');
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState(DEFAULT_PAN);
  const [panning, setPanning] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [draggingNode, setDraggingNode] = useState<{
    nodeId: string;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const markerId = `architect-edge-arrow-${useId().replaceAll(':', '')}`;

  useEffect(() => {
    setZoom(DEFAULT_ZOOM);
    setPan(DEFAULT_PAN);
    setPanning(null);
    setDraggingNode(null);
    setEditMode('select');
    setConnectSourceId(null);
  }, [schema?.id]);

  const zoomIn = useCallback(() => setZoom((current) => clampZoom(current + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((current) => clampZoom(current - ZOOM_STEP)), []);
  const resetViewport = useCallback(() => {
    setZoom(DEFAULT_ZOOM);
    setPan(DEFAULT_PAN);
  }, []);

  const setMode = useCallback((mode: 'select' | 'add' | 'connect', kind?: ArchitectureNodeKind) => {
    setEditMode(mode);
    if (kind) {
      setAddNodeKind(kind);
    }
    setConnectSourceId(null);
  }, []);

  const startPan = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!canStartPan(event.target, event.altKey, event.button)) {
      return;
    }
    event.preventDefault();
    const pointerId = event.pointerId ?? 0;
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(pointerId);
    }
    setPanning({
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    });
  }, [pan]);

  const movePan = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    if (!panning || pointerId !== panning.pointerId) {
      return;
    }
    setPan({
      x: panning.originX + (event.clientX - panning.startX),
      y: panning.originY + (event.clientY - panning.startY),
    });
  }, [panning]);

  const endPan = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    if (!panning || pointerId !== panning.pointerId) {
      return;
    }
    if (
      typeof event.currentTarget.hasPointerCapture === 'function'
      && typeof event.currentTarget.releasePointerCapture === 'function'
      && event.currentTarget.hasPointerCapture(pointerId)
    ) {
      event.currentTarget.releasePointerCapture(pointerId);
    }
    setPanning(null);
  }, [panning]);

  const handleWheel = useCallback((event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    setZoom((current) => clampZoom(current + (event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP)));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const startMousePan = useCallback((event: MouseEvent<HTMLElement>) => {
    if (hasPointerEvents() || !canStartPan(event.target, event.altKey, event.button)) {
      return;
    }
    event.preventDefault();
    setPanning({
      pointerId: MOUSE_FALLBACK_POINTER_ID,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    });
  }, [pan]);

  const moveMousePan = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!panning || panning.pointerId !== MOUSE_FALLBACK_POINTER_ID) {
      return;
    }
    setPan({
      x: panning.originX + (event.clientX - panning.startX),
      y: panning.originY + (event.clientY - panning.startY),
    });
  }, [panning]);

  const endMousePan = useCallback(() => {
    if (panning?.pointerId === MOUSE_FALLBACK_POINTER_ID) {
      setPanning(null);
    }
  }, [panning]);

  const canvasPosition = useCallback((event: { clientX: number; clientY: number }, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - pan.x) / zoom,
      y: (event.clientY - rect.top - pan.y) / zoom,
    };
  }, [pan, zoom]);

  const handleCanvasClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (runtimeMode || editMode !== 'add') {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-architect-control="true"]')) {
      return;
    }
    onAddNode(canvasPosition(event, event.currentTarget), addNodeKind);
    setMode('select');
  }, [addNodeKind, canvasPosition, editMode, onAddNode, runtimeMode, setMode]);

  const handleNodeClick = useCallback((nodeId: string) => {
    if (runtimeMode) {
      onSelectNode(nodeId);
      return;
    }
    if (editMode !== 'connect') {
      onSelectNode(nodeId);
      return;
    }
    if (!connectSourceId) {
      setConnectSourceId(nodeId);
      onSelectNode(nodeId);
      return;
    }
    onToggleEdge(connectSourceId, nodeId);
    setMode('select');
  }, [connectSourceId, editMode, onSelectNode, onToggleEdge, runtimeMode, setMode]);

  const startNodeDrag = useCallback((event: PointerEvent<HTMLElement>, node: ArchitectNode) => {
    if (runtimeMode) {
      onSelectNode(node.id);
      return;
    }
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId ?? 0;
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(pointerId);
    }
    onSelectNode(node.id);
    setDraggingNode({
      nodeId: node.id,
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y,
    });
  }, [onSelectNode, runtimeMode]);

  const moveNodeDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    if (!draggingNode || pointerId !== draggingNode.pointerId) {
      return;
    }
    event.preventDefault();
    onMoveNode(draggingNode.nodeId, {
      x: draggingNode.originX + (event.clientX - draggingNode.startX) / zoom,
      y: draggingNode.originY + (event.clientY - draggingNode.startY) / zoom,
    });
  }, [draggingNode, onMoveNode, zoom]);

  const endNodeDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    if (!draggingNode || pointerId !== draggingNode.pointerId) {
      return;
    }
    if (
      typeof event.currentTarget.hasPointerCapture === 'function'
      && typeof event.currentTarget.releasePointerCapture === 'function'
      && event.currentTarget.hasPointerCapture(pointerId)
    ) {
      event.currentTarget.releasePointerCapture(pointerId);
    }
    setDraggingNode(null);
  }, [draggingNode]);

  const nodes = schema?.nodes ?? EMPTY_NODES;
  const schemaEdges = schema?.edges ?? EMPTY_EDGES;
  const executedEdgeIds = useMemo(() => new Set((routeHops ?? []).map((hop) => `${hop.fromNodeId}->${hop.toNodeId}`)), [routeHops]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const edges = useMemo(() => {
    const pairs = schemaEdges.length > 0
      ? schemaEdges.map((edge) => ({ id: edge.id, sourceId: edge.fromNodeId, targetId: edge.toNodeId }))
      : nodes.flatMap((node) => node.connections.map((targetId) => ({
        id: `${node.id}-${targetId}`,
        sourceId: node.id,
        targetId,
      })));

    return pairs.flatMap((pair) => {
      const sourceNode = nodeById.get(pair.sourceId);
      const targetNode = nodeById.get(pair.targetId);
      if (!sourceNode || !targetNode) {
        return [];
      }
      const source = outputPin(sourceNode);
      const target = inputPin(targetNode);
      const kind = edgeKind(sourceNode);
      return {
        id: pair.id,
        path: connectionPath(source, target),
        kind,
        executed: executedEdgeIds.has(`${pair.sourceId}->${pair.targetId}`),
      };
    });
  }, [executedEdgeIds, nodeById, nodes, schemaEdges]);

  if (!schema) {
    return (
      <section className="flex flex-1 items-center justify-center bg-[#080b12] text-sm text-base-content/40">
        No architecture schema loaded.
      </section>
    );
  }

  return (
    <section
      ref={canvasRef}
      className="relative flex-1 overflow-hidden bg-[#080b12]"
      data-testid="architect-graph-canvas"
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onMouseDown={startMousePan}
      onMouseMove={moveMousePan}
      onMouseUp={endMousePan}
      onMouseLeave={endMousePan}
      onClick={handleCanvasClick}
      style={{
        backgroundImage: [
          'radial-gradient(circle at 72% 18%, rgba(34, 197, 94, 0.12), transparent 34%)',
          'radial-gradient(circle at 28% 70%, rgba(56, 189, 248, 0.10), transparent 32%)',
          'radial-gradient(circle, rgba(148, 163, 184, 0.20) 1px, transparent 1px)',
        ].join(', '),
        backgroundSize: `auto, auto, ${22 * zoom}px ${22 * zoom}px`,
        backgroundPosition: `center, center, ${pan.x}px ${pan.y}px`,
        cursor: panning ? 'grabbing' : editMode === 'add' ? 'crosshair' : 'default',
      }}
    >
      <div
        className="absolute inset-0"
        data-testid="architect-canvas-transform"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <div
          className="relative"
          style={{ minHeight: FREE_SPACE_HEIGHT, minWidth: FREE_SPACE_WIDTH }}
          data-testid="architect-canvas-free-space"
        >
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            <defs>
              <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 z" className="fill-sky-400/70" />
              </marker>
            </defs>
            {edges.map((edge) => (
              <g key={edge.id}>
                <path
                  d={edge.path}
                  fill="none"
                  className={edgeHaloClass(edge.kind, edge.executed)}
                  strokeWidth={edge.executed ? '7' : '5'}
                />
                <path
                  d={edge.path}
                  fill="none"
                  className={edgeClass(edge.kind, edge.executed)}
                  markerEnd={`url(#${markerId})`}
                  strokeDasharray={edgeDash(edge.kind)}
                  strokeWidth={edgeWidth(edge.kind, edge.executed)}
                  data-testid={`architect-edge-${edge.id}`}
                  data-edge-kind={edge.kind}
                />
              </g>
            ))}
          </svg>

          {schema.nodes.map((node) => (
            <ArchitectGraphNodeCard
              key={node.id}
              node={node}
              selectedNodeId={selectedNodeId}
              selectedSlotId={selectedSlotId}
              connectSourceId={connectSourceId}
              onNodeClick={handleNodeClick}
              onSlotClick={onSelectSlot}
              onDragStart={startNodeDrag}
              onDragMove={moveNodeDrag}
              onDragEnd={endNodeDrag}
            />
          ))}
        </div>
      </div>

      <ArchitectGraphToolbar
        editMode={runtimeMode ? 'select' : editMode}
        addNodeKind={addNodeKind}
        zoom={zoom}
        onModeChange={runtimeMode ? () => undefined : setMode}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetViewport={resetViewport}
        onAutoLayout={runtimeMode ? () => undefined : onAutoLayout}
      />
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
    </section>
  );
}
