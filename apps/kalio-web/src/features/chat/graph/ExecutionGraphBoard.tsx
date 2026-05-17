import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';
import {
  Bot, Boxes, BrainCircuit, CheckCircle2, FolderTree, MessageSquareText, Wrench,
} from 'lucide-react';
import {
  type ExecutionGraphModel,
  type ExecutionGraphNode,
  type ExecutionGraphNodeKind,
} from './executionGraphModel';
import { GraphNodePreviewThumbnail, extractGraphNodePreview } from './ExecutionGraphPreview';
import { getGraphNodeHeading, getGraphNodeMetadata } from './executionGraphNodePresentation';

const NODE_COLORS: Record<ExecutionGraphNodeKind, string> = {
  prompt: 'from-sky-600/85 to-cyan-500/75 border-sky-300/40',
  turn: 'from-violet-600/85 to-fuchsia-500/75 border-violet-200/40',
  'tool-group': 'from-emerald-600/80 to-teal-500/75 border-emerald-200/40',
  tool: 'from-amber-600/85 to-orange-500/75 border-amber-200/40',
  subagent: 'from-indigo-600/85 to-violet-500/75 border-indigo-200/40',
  artifact: 'from-slate-600/85 to-slate-500/75 border-slate-200/40',
  'final-answer': 'from-green-700/85 to-emerald-500/75 border-emerald-100/45',
};

const MIN_NODE_WIDTH = 120;
const MIN_NODE_HEIGHT = 80;

type NodeLayout = Pick<ExecutionGraphNode, 'x' | 'y' | 'width' | 'height'>;
type NodeInteractionMode = 'move' | 'resize';

function nodeIcon(kind: ExecutionGraphNodeKind) {
  switch (kind) {
    case 'prompt':
      return <MessageSquareText size={16} />;
    case 'turn':
      return <Bot size={16} />;
    case 'tool-group':
      return <Boxes size={16} />;
    case 'tool':
      return <Wrench size={16} />;
    case 'subagent':
      return <BrainCircuit size={16} />;
    case 'artifact':
      return <FolderTree size={16} />;
    case 'final-answer':
      return <CheckCircle2 size={16} />;
  }
}

function statusTone(status: ExecutionGraphNode['status']): string {
  if (status === 'error') return 'text-rose-200';
  if (status === 'running') return 'text-amber-100';
  if (status === 'success') return 'text-emerald-100';
  return 'text-slate-200';
}

function statusLabel(status: ExecutionGraphNode['status']): string {
  if (status === 'error') return 'error';
  if (status === 'running') return 'running';
  if (status === 'success') return 'ready';
  return 'idle';
}

function buildEdgePath(source: ExecutionGraphNode, target: ExecutionGraphNode): string {
  const targetIsToolBranch = target.kind === 'tool' || target.kind === 'tool-group';

  if (targetIsToolBranch && target.y >= source.y) {
    const startX = source.x + source.width / 2;
    const startY = source.y + source.height;
    const endX = target.x + target.width / 2;
    const endY = target.y;
    const delta = Math.max((endY - startY) / 2, 40);

    return `M ${startX} ${startY} C ${startX} ${startY + delta}, ${endX} ${endY - delta}, ${endX} ${endY}`;
  }

  const startX = source.x + source.width;
  const startY = source.y + source.height / 2;
  const endX = target.x;
  const endY = target.y + target.height / 2;
  const delta = Math.max((endX - startX) / 2, 40);

  return `M ${startX} ${startY} C ${startX + delta} ${startY}, ${endX - delta} ${endY}, ${endX} ${endY}`;
}

function GraphNodeCard({
  node,
  selected,
  onSelect,
  onDragStart,
  onResizeStart,
  interacting,
}: {
  node: ExecutionGraphNode;
  selected: boolean;
  onSelect: () => void;
  onDragStart: (event: MouseEvent<HTMLDivElement>) => void;
  onResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  interacting: NodeInteractionMode | null;
}) {
  const preview = extractGraphNodePreview(node);
  const { eyebrow, headline, supporting } = getGraphNodeHeading(node);
  const metadata = getGraphNodeMetadata(node);

  return (
    <div
      data-testid={`graph-node-${node.id}`}
      data-graph-node-card="true"
      role="button"
      tabIndex={0}
      className={`absolute overflow-hidden rounded-[22px] border bg-gradient-to-br shadow-[0_18px_30px_rgba(2,12,27,0.28)] transition-all ${NODE_COLORS[node.kind]} ${selected ? 'ring-2 ring-sky-300/85 scale-[1.01]' : 'hover:scale-[1.01] hover:shadow-[0_20px_34px_rgba(2,12,27,0.34)]'} ${interacting === 'move' ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onMouseDown={onDragStart}
      onClick={onSelect}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="flex h-full flex-col overflow-hidden px-4 py-3 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className={`inline-flex max-w-full items-center gap-2 rounded-full border border-white/12 bg-black/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${statusTone(node.status)}`}>
              {nodeIcon(node.kind)}
              <span className="truncate">{eyebrow}</span>
            </div>
            <p className="mt-3 text-[15px] font-semibold leading-snug text-white break-words">{headline}</p>
          </div>
          <span className="rounded-full border border-white/15 bg-black/15 px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-white/80">
            {statusLabel(node.status)}
          </span>
        </div>

        {supporting ? (
          <p className="mt-3 overflow-hidden text-xs leading-5 text-slate-100/72 break-words">{supporting}</p>
        ) : null}

        {metadata.length > 0 && (
          <dl className="mt-3 grid grid-cols-2 gap-2 overflow-hidden">
            {metadata.map((item) => {
              const toneClass = item.tone === 'warning'
                ? 'border-amber-200/20 bg-amber-950/25'
                : item.tone === 'accent'
                  ? 'border-sky-200/18 bg-sky-950/25'
                  : 'border-white/12 bg-black/15';

              return (
                <div key={`${item.label}:${item.value}`} className={`overflow-hidden rounded-2xl border px-2.5 py-2 ${toneClass}`}>
                  <dt className="text-[10px] uppercase tracking-[0.18em] text-sky-100/70">{item.label}</dt>
                  <dd className="mt-1 overflow-hidden text-xs font-medium leading-5 text-white/94 break-words">{item.value}</dd>
                </div>
              );
            })}
          </dl>
        )}

        {preview ? (
          <GraphNodePreviewThumbnail node={node} />
        ) : null}
      </div>

      <div
        data-testid={`graph-node-resize-${node.id}`}
        data-graph-node-resize="true"
        className={`absolute bottom-2 right-2 flex h-4 w-4 items-center justify-center rounded-full border border-white/20 bg-black/25 text-white/70 ${interacting === 'resize' ? 'cursor-se-resize' : 'cursor-se-resize'}`}
        onMouseDown={onResizeStart}
      >
        <span className="text-[10px] leading-none">+</span>
      </div>
    </div>
  );
}

interface ExecutionGraphBoardProps {
  model: ExecutionGraphModel;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  zoom: number;
  onWheelZoom?: (deltaY: number) => void;
}

export function ExecutionGraphBoard({
  model,
  selectedNodeId,
  onSelectNode,
  zoom,
  onWheelZoom,
}: ExecutionGraphBoardProps) {
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [nodeLayouts, setNodeLayouts] = useState<Record<string, NodeLayout>>({});
  const [activeNodeInteraction, setActiveNodeInteraction] = useState<{ nodeId: string; mode: NodeInteractionMode } | null>(null);
  const nodeInteractionRef = useRef<{
    nodeId: string;
    mode: NodeInteractionMode;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  const graphNodes = model.nodes.map((node) => ({
    ...node,
    ...(nodeLayouts[node.id] ?? {}),
  }));
  const graphNodeById = new Map(graphNodes.map((node) => [node.id, node]));
  const boardWidth = graphNodes.reduce((value, node) => Math.max(value, node.x + node.width + 80), model.board.width);
  const boardHeight = graphNodes.reduce((value, node) => Math.max(value, node.y + node.height + 80), model.board.height);

  const startNodeInteraction = (event: MouseEvent<HTMLDivElement>, nodeId: string, mode: NodeInteractionMode) => {
    event.preventDefault();
    event.stopPropagation();

    const node = graphNodeById.get(nodeId);
    if (!node) {
      return;
    }

    nodeInteractionRef.current = {
      nodeId,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: node.x,
      startY: node.y,
      startWidth: node.width,
      startHeight: node.height,
    };
    setActiveNodeInteraction({ nodeId, mode });
  };

  useEffect(() => {
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const interaction = nodeInteractionRef.current;
      if (!interaction) {
        return;
      }

      const deltaX = (event.clientX - interaction.startClientX) / zoom;
      const deltaY = (event.clientY - interaction.startClientY) / zoom;

      setNodeLayouts((current) => ({
        ...current,
        [interaction.nodeId]: interaction.mode === 'move'
          ? {
              x: Math.max(0, Math.round(interaction.startX + deltaX)),
              y: Math.max(0, Math.round(interaction.startY + deltaY)),
              width: interaction.startWidth,
              height: interaction.startHeight,
            }
          : {
              x: interaction.startX,
              y: interaction.startY,
              width: Math.max(MIN_NODE_WIDTH, Math.round(interaction.startWidth + deltaX)),
              height: Math.max(MIN_NODE_HEIGHT, Math.round(interaction.startHeight + deltaY)),
            },
      }));
    };

    const stopNodeInteraction = () => {
      nodeInteractionRef.current = null;
      setActiveNodeInteraction(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopNodeInteraction);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', stopNodeInteraction);
    };
  }, [zoom]);

  const updatePan = (clientX: number, clientY: number) => {
    const dragState = dragStateRef.current;
    if (!dragState) {
      return;
    }

    setPan({
      x: dragState.panX + (clientX - dragState.startX),
      y: dragState.panY + (clientY - dragState.startY),
    });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target;
    if (target instanceof HTMLElement && target.closest('[data-graph-node-card="true"]')) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    updatePan(event.clientX, event.clientY);
  };

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current && event.currentTarget.hasPointerCapture(dragStateRef.current.pointerId)) {
      event.currentTarget.releasePointerCapture(dragStateRef.current.pointerId);
    }
    dragStateRef.current = null;
    setDragging(false);
  };

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target;
    if (target instanceof HTMLElement && target.closest('[data-graph-node-card="true"]')) {
      return;
    }

    dragStateRef.current = {
      pointerId: -1,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setDragging(true);
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    updatePan(event.clientX, event.clientY);
  };

  const stopMouseDragging = () => {
    dragStateRef.current = null;
    setDragging(false);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!onWheelZoom) {
      return;
    }

    event.preventDefault();
    onWheelZoom(event.deltaY);
  };

  return (
    <div
      data-testid="execution-graph-viewport"
      className={`flex-1 overflow-hidden overscroll-none select-none touch-none bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.10),_transparent_42%),linear-gradient(rgba(56,189,248,0.08)_1px,_transparent_1px),linear-gradient(90deg,_rgba(56,189,248,0.08)_1px,_transparent_1px)] bg-[length:100%_100%,40px_40px,40px_40px] bg-[#0a1220] ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopMouseDragging}
      onMouseLeave={stopMouseDragging}
      onWheel={handleWheel}
    >
      <div
        className="relative min-w-full min-h-full"
        style={{
          width: Math.max(boardWidth * zoom, boardWidth),
          height: Math.max(boardHeight * zoom, boardHeight),
        }}
      >
        <div
          data-testid="execution-graph-stage"
          className="relative origin-top-left will-change-transform"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          <div
            className="relative origin-top-left"
            style={{ width: boardWidth, height: boardHeight, transform: `scale(${zoom})` }}
          >
            <svg className="absolute inset-0 overflow-visible" width={boardWidth} height={boardHeight} aria-hidden="true">
              <defs>
                <marker id="graph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(125, 211, 252, 0.85)" />
                </marker>
              </defs>
              {model.edges.map((edge) => {
                const source = graphNodeById.get(edge.sourceId);
                const target = graphNodeById.get(edge.targetId);
                if (!source || !target) return null;
                const path = buildEdgePath(source, target);

                return (
                  <path
                    key={edge.id}
                    data-testid={`graph-edge-${edge.id}`}
                    d={path}
                    fill="none"
                    markerEnd="url(#graph-arrow)"
                    stroke={edge.style === 'dashed' ? 'rgba(148,163,184,0.6)' : 'rgba(125,211,252,0.9)'}
                    strokeDasharray={edge.style === 'dashed' ? '7 8' : undefined}
                    strokeWidth={edge.style === 'dashed' ? 2 : 3}
                  />
                );
              })}
            </svg>

            {graphNodes.map((node) => (
              <GraphNodeCard
                key={node.id}
                node={node}
                selected={node.id === selectedNodeId}
                onSelect={() => onSelectNode(node.id)}
                onDragStart={(event) => startNodeInteraction(event, node.id, 'move')}
                onResizeStart={(event) => startNodeInteraction(event, node.id, 'resize')}
                interacting={activeNodeInteraction?.nodeId === node.id ? activeNodeInteraction.mode : null}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
