import type { PointerEvent } from 'react';
import type { ArchitectNode, ArchitectSchema } from './architect.types';
import { ArchitectGraphNodeCard } from './ArchitectGraphNodeCard';

export function ArchitectGraphNodeLayer({
  connectSourceId,
  nodes,
  onDragEnd,
  onDragMove,
  onDragStart,
  onNodeClick,
  onSlotClick,
  selectedNodeId,
  selectedSlotId,
}: {
  connectSourceId: string | null;
  nodes: ArchitectSchema['nodes'];
  onDragEnd: (event: PointerEvent<HTMLElement>) => void;
  onDragMove: (event: PointerEvent<HTMLElement>) => void;
  onDragStart: (event: PointerEvent<HTMLElement>, node: ArchitectNode) => void;
  onNodeClick: (nodeId: string) => void;
  onSlotClick: (nodeId: string, slotId: string) => void;
  selectedNodeId: string | null;
  selectedSlotId: string | null;
}) {
  return (
    <>
      {nodes.map((node) => (
        <ArchitectGraphNodeCard
          key={node.id}
          node={node}
          selectedNodeId={selectedNodeId}
          selectedSlotId={selectedSlotId}
          connectSourceId={connectSourceId}
          onNodeClick={onNodeClick}
          onSlotClick={onSlotClick}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        />
      ))}
    </>
  );
}
