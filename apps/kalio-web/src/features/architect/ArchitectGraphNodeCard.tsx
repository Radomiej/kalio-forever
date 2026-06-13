import type { MouseEvent, PointerEvent } from 'react';
import { Box, Bot, GitBranch, Route } from 'lucide-react';
import type { ArchitectNode, ArchitectSlot } from './architect.types';
import { getNodeDimensions, pinHitboxSize } from './ArchitectGraphGeometry';

interface ArchitectGraphNodeCardProps {
  node: ArchitectNode;
  selectedNodeId: string | null;
  selectedSlotId: string | null;
  connectSourceId: string | null;
  connectionDropTarget: boolean;
  zoom: number;
  onNodeClick: (nodeId: string) => void;
  onSlotClick: (nodeId: string, slotId: string) => void;
  onStartConnection: (nodeId: string) => void;
  onCompleteConnection: (nodeId: string) => void;
  onStartConnectionDrag: (event: PointerEvent<HTMLElement>, nodeId: string) => void;
  onMoveConnectionDrag: (event: PointerEvent<HTMLElement>) => void;
  onEndConnectionDrag: (event: PointerEvent<HTMLElement>) => void;
  onDragStart: (event: PointerEvent<HTMLElement>, node: ArchitectNode) => void;
  onDragMove: (event: PointerEvent<HTMLElement>) => void;
  onDragEnd: (event: PointerEvent<HTMLElement>) => void;
}

function slotButtonClass(slot: ArchitectSlot, selectedSlotId: string | null): string {
  return `min-h-10 min-w-12 rounded-md border px-2 py-1.5 text-[9px] font-medium leading-tight transition-colors ${
    selectedSlotId === slot.id
      ? 'border-sky-400 bg-sky-500/20 text-sky-100'
      : 'border-base-300 bg-base-100/70 text-base-content/65 hover:border-sky-500/40 hover:text-base-content'
  }`;
}

function behaviorLabel(node: ArchitectNode): string | null {
  return node.behavior && (node.kind === 'parallel' || node.kind === 'router')
    ? node.behavior.mode.replaceAll('_', ' ')
    : null;
}

function nodeAccentClass(node: ArchitectNode): string {
  if (node.kind === 'router') return 'border-amber-300/45 bg-amber-400/15 text-amber-100';
  if (node.kind === 'parallel') return 'border-violet-300/45 bg-violet-400/15 text-violet-100';
  if (node.kind === 'artifact') return 'border-emerald-300/45 bg-emerald-400/15 text-emerald-100';
  return 'border-sky-300/35 bg-sky-400/12 text-sky-100';
}

function kindBadgeClass(node: ArchitectNode): string {
  if (node.kind === 'router') return 'border-amber-400/30 bg-amber-500/10 text-amber-200';
  if (node.kind === 'parallel') return 'border-violet-400/30 bg-violet-500/10 text-violet-200';
  if (node.kind === 'artifact') return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200';
  return 'border-base-300/80 bg-base-200/70 text-base-content/55';
}

function nodeSurfaceClass(node: ArchitectNode): string {
  if (node.kind === 'router') return 'border-amber-300/35 bg-[linear-gradient(135deg,rgba(251,191,36,0.16),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(251,191,36,0.9)]';
  if (node.kind === 'parallel') return 'border-violet-300/30 bg-[linear-gradient(135deg,rgba(139,92,246,0.14),rgba(15,23,42,0.94)_46%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(139,92,246,0.8)]';
  if (node.kind === 'artifact') return 'border-emerald-300/30 bg-[linear-gradient(135deg,rgba(16,185,129,0.13),rgba(15,23,42,0.94)_46%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(16,185,129,0.75)]';
  return 'border-sky-300/25 bg-[linear-gradient(135deg,rgba(14,165,233,0.10),rgba(15,23,42,0.94)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(14,165,233,0.65)]';
}

function nodeIcon(node: ArchitectNode) {
  if (node.kind === 'router') return Route;
  if (node.kind === 'parallel') return GitBranch;
  if (node.kind === 'artifact') return Box;
  return Bot;
}

export function ArchitectGraphNodeCard({
  node,
  selectedNodeId,
  selectedSlotId,
  connectSourceId,
  connectionDropTarget,
  zoom,
  onNodeClick,
  onSlotClick,
  onStartConnection,
  onCompleteConnection,
  onStartConnectionDrag,
  onMoveConnectionDrag,
  onEndConnectionDrag,
  onDragStart,
  onDragMove,
  onDragEnd,
}: ArchitectGraphNodeCardProps) {
  const KindIcon = nodeIcon(node);
  const outputPinClass = node.kind === 'router'
    ? 'border-amber-100/80 shadow-[0_0_12px_rgba(251,191,36,0.46)]'
    : 'border-emerald-100/75 shadow-[0_0_12px_rgba(16,185,129,0.38)]';
  const outputPinDotClass = node.kind === 'router' ? 'bg-amber-200' : 'bg-emerald-200';
  const dimensions = getNodeDimensions(node);
  const connectorHitboxSize = pinHitboxSize(zoom);
  const handleCardPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.altKey) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button') || target?.closest('[data-architect-pin="true"]')) {
      event.stopPropagation();
    }
  };
  const handleCardClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button') || target?.closest('[data-architect-pin="true"]')) {
      return;
    }
    onNodeClick(node.id);
  };

  return (
    <div
      className={`absolute rounded-lg border p-2 backdrop-blur transition-colors ${nodeSurfaceClass(node)} ${
        selectedNodeId === node.id || connectSourceId === node.id ? 'ring-1 ring-sky-400/60' : ''
      } ${connectionDropTarget ? 'ring-2 ring-sky-200/90 shadow-[0_0_0_1px_rgba(125,211,252,0.45),0_18px_38px_rgba(8,47,73,0.32)]' : ''
      }`}
      data-architect-connection-drop-target={connectionDropTarget ? 'true' : undefined}
      data-architect-control="true"
      onPointerDown={handleCardPointerDown}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
      onClick={handleCardClick}
      style={{
        left: node.x,
        top: node.y,
        width: dimensions.width,
        minHeight: dimensions.height,
      }}
      data-testid={`architect-node-card-${node.id}`}
    >
      <button
        type="button"
        className={`group absolute left-0 top-1/2 z-10 flex h-14 w-14 -translate-x-[70%] -translate-y-1/2 items-center justify-center rounded-full bg-transparent transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 ${connectionDropTarget ? 'scale-110 ring-2 ring-sky-200/80 ring-offset-2 ring-offset-[#07111d]' : ''}`}
        style={{ height: connectorHitboxSize, width: connectorHitboxSize }}
        data-testid={node.kind === 'router' ? `architect-router-input-pin-${node.id}` : `architect-node-input-pin-${node.id}`}
        title={`${node.label} input`}
        aria-label={`Connect to ${node.label}`}
        data-architect-pin="true"
        data-architect-input-node-id={node.id}
        onClick={() => onCompleteConnection(node.id)}
        onPointerDown={(event) => {
          if (!event.altKey) {
            event.stopPropagation();
          }
        }}
        onPointerMove={onMoveConnectionDrag}
        onPointerUp={onEndConnectionDrag}
        onPointerCancel={onEndConnectionDrag}
      >
        <span className={`h-1.5 w-1.5 rounded-full border border-sky-200/75 bg-[#07111d] shadow-[0_0_5px_rgba(56,189,248,0.32)] group-hover:h-2 group-hover:w-2 group-hover:bg-sky-950 ${connectionDropTarget ? 'h-2 w-2 bg-sky-200 shadow-[0_0_12px_rgba(125,211,252,0.8)]' : ''}`} />
      </button>
      <button
        type="button"
        className="group absolute right-0 top-1/2 z-10 flex h-14 w-14 translate-x-[70%] -translate-y-1/2 items-center justify-center rounded-full bg-transparent transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
        style={{ height: connectorHitboxSize, width: connectorHitboxSize }}
        data-testid={node.kind === 'router' ? `architect-router-output-pin-${node.id}` : `architect-node-output-pin-${node.id}`}
        title={`${node.label} output`}
        aria-label={`Connect from ${node.label}`}
        data-architect-pin="true"
        onClick={() => onStartConnection(node.id)}
        onPointerDown={(event) => onStartConnectionDrag(event, node.id)}
        onPointerMove={onMoveConnectionDrag}
        onPointerUp={onEndConnectionDrag}
        onPointerCancel={onEndConnectionDrag}
      >
        <span className={`h-1.5 w-1.5 rounded-full border bg-[#07111d] group-hover:h-2 group-hover:w-2 group-hover:bg-slate-950 ${outputPinClass} ${outputPinDotClass}`} />
      </button>
      <div className="flex w-full items-start gap-2">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded-md border active:cursor-grabbing ${nodeAccentClass(node)}`}
          onPointerDown={(event) => onDragStart(event, node)}
          title="Drag node"
          data-testid={`architect-node-drag-${node.id}`}
        >
          <KindIcon size={13} />
        </span>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onNodeClick(node.id)}
          data-testid={`architect-node-${node.id}`}
        >
          <span className="block truncate text-[11px] font-semibold text-base-content">{node.label}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            <span
              className={`rounded border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${kindBadgeClass(node)}`}
              data-testid={`architect-node-kind-${node.id}`}
            >
              {node.kind}
            </span>
            {behaviorLabel(node) && (
              <span
                className="rounded border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-sky-200"
                data-testid={`architect-node-behavior-${node.id}`}
              >
                {behaviorLabel(node)}
              </span>
            )}
            {node.role && (
              <span className="truncate text-[9px] uppercase tracking-wide text-base-content/60">
                {node.role}
              </span>
            )}
          </span>
        </button>
      </div>

      {node.slots.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {node.slots.map((slot) => (
            <button
              key={slot.id}
              type="button"
              className={slotButtonClass(slot, selectedSlotId)}
              onClick={() => onSlotClick(node.id, slot.id)}
              onPointerDown={(event) => event.stopPropagation()}
              data-testid={`architect-slot-${slot.id}`}
            >
              {slot.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
