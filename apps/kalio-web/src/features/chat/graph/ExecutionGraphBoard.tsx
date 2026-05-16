import { useRef, useState, type MouseEvent, type WheelEvent } from 'react';
import {
  Bot, Boxes, BrainCircuit, CheckCircle2, FolderTree, MessageSquareText, Wrench,
} from 'lucide-react';
import {
  type ExecutionGraphModel,
  type ExecutionGraphNode,
  type ExecutionGraphNodeKind,
} from './executionGraphModel';
import { GraphNodePreviewThumbnail, extractGraphNodePreview } from './ExecutionGraphPreview';

const NODE_COLORS: Record<ExecutionGraphNodeKind, string> = {
  prompt: 'from-sky-600/85 to-cyan-500/75 border-sky-300/40',
  turn: 'from-violet-600/85 to-fuchsia-500/75 border-violet-200/40',
  'tool-group': 'from-emerald-600/80 to-teal-500/75 border-emerald-200/40',
  tool: 'from-amber-600/85 to-orange-500/75 border-amber-200/40',
  subagent: 'from-indigo-600/85 to-violet-500/75 border-indigo-200/40',
  artifact: 'from-slate-600/85 to-slate-500/75 border-slate-200/40',
  'final-answer': 'from-green-700/85 to-emerald-500/75 border-emerald-100/45',
};

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
}: {
  node: ExecutionGraphNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const preview = extractGraphNodePreview(node);
  const turnBadges = node.payload.kind === 'turn'
    ? [
        `${node.payload.toolCount} tool${node.payload.toolCount === 1 ? '' : 's'}`,
        `${node.payload.thinkingCount} thinking`,
      ]
    : [];

  return (
    <button
      type="button"
      data-testid={`graph-node-${node.id}`}
      data-graph-node-card="true"
      className={`absolute overflow-hidden text-left rounded-[22px] border bg-gradient-to-br px-4 py-3 shadow-[0_18px_30px_rgba(2,12,27,0.28)] transition-all ${NODE_COLORS[node.kind]} ${selected ? 'ring-2 ring-sky-300/85 scale-[1.01]' : 'hover:scale-[1.01] hover:shadow-[0_20px_34px_rgba(2,12,27,0.34)]'}`}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`inline-flex items-center gap-2 text-sm font-semibold ${statusTone(node.status)}`}>
            {nodeIcon(node.kind)}
            <span className="truncate">{node.title}</span>
          </div>
          <p className="mt-2 text-sm font-medium text-white/92 line-clamp-2 break-words">{node.subtitle}</p>
        </div>
        <span className="rounded-full border border-white/15 bg-black/15 px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-white/80">
          {statusLabel(node.status)}
        </span>
      </div>

      {turnBadges.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {turnBadges.map((badge) => (
            <span key={badge} className="rounded-full border border-white/15 bg-black/15 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-white/75">
              {badge}
            </span>
          ))}
        </div>
      )}

      {node.payload.kind === 'tool' && node.payload.confirmationRequired && (
        <div className="mt-3 inline-flex items-center rounded-full border border-amber-200/20 bg-black/15 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-amber-100">
          Accept required
        </div>
      )}

      {preview ? (
        <GraphNodePreviewThumbnail node={node} />
      ) : node.detail ? (
        <p className="mt-3 text-xs text-white/72 line-clamp-2 break-words">{node.detail}</p>
      ) : null}
    </button>
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
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target;
    if (target instanceof HTMLElement && target.closest('[data-graph-node-card="true"]')) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    setDragging(true);
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const dragState = dragStateRef.current;
    if (!viewport || !dragState) {
      return;
    }

    viewport.scrollLeft = dragState.scrollLeft - (event.clientX - dragState.startX);
    viewport.scrollTop = dragState.scrollTop - (event.clientY - dragState.startY);
  };

  const stopDragging = () => {
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
      ref={viewportRef}
      data-testid="execution-graph-viewport"
      className={`flex-1 overflow-auto overscroll-none bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.10),_transparent_42%),linear-gradient(rgba(56,189,248,0.08)_1px,_transparent_1px),linear-gradient(90deg,_rgba(56,189,248,0.08)_1px,_transparent_1px)] bg-[length:100%_100%,40px_40px,40px_40px] bg-[#0a1220] ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopDragging}
      onMouseLeave={stopDragging}
      onWheel={handleWheel}
    >
      <div
        className="relative min-w-full min-h-full"
        style={{
          width: Math.max(model.board.width * zoom, model.board.width),
          height: Math.max(model.board.height * zoom, model.board.height),
        }}
      >
        <div
          className="relative origin-top-left"
          style={{ width: model.board.width, height: model.board.height, transform: `scale(${zoom})` }}
        >
          <svg className="absolute inset-0 overflow-visible" width={model.board.width} height={model.board.height} aria-hidden="true">
            <defs>
              <marker id="graph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(125, 211, 252, 0.85)" />
              </marker>
            </defs>
            {model.edges.map((edge) => {
              const source = model.nodes.find((node) => node.id === edge.sourceId);
              const target = model.nodes.find((node) => node.id === edge.targetId);
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

          {model.nodes.map((node) => (
            <GraphNodeCard
              key={node.id}
              node={node}
              selected={node.id === selectedNodeId}
              onSelect={() => onSelectNode(node.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
