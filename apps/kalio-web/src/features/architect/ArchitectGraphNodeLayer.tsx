import type { PointerEvent } from 'react';
import type { ArchitectNode, ArchitectSchema } from './architect.types';
import { ArchitectGraphNodeCard } from './ArchitectGraphNodeCard';

export function ArchitectGraphNodeLayer({
  connectSourceId,
  connectionDropTargetId,
  nodes,
  onDragEnd,
  onDragMove,
  onDragStart,
  onNodeClick,
  onSlotClick,
  onStartConnection,
  onCompleteConnection,
  onStartConnectionDrag,
  onMoveConnectionDrag,
  onEndConnectionDrag,
  selectedNodeId,
  selectedSlotId,
  zoom,
}: {
  connectSourceId: string | null;
  connectionDropTargetId: string | null;
  nodes: ArchitectSchema['nodes'];
  onDragEnd: (event: PointerEvent<HTMLElement>) => void;
  onDragMove: (event: PointerEvent<HTMLElement>) => void;
  onDragStart: (event: PointerEvent<HTMLElement>, node: ArchitectNode) => void;
  onNodeClick: (nodeId: string) => void;
  onSlotClick: (nodeId: string, slotId: string) => void;
  onStartConnection: (nodeId: string) => void;
  onCompleteConnection: (nodeId: string) => void;
  onStartConnectionDrag: (event: PointerEvent<HTMLElement>, nodeId: string) => void;
  onMoveConnectionDrag: (event: PointerEvent<HTMLElement>) => void;
  onEndConnectionDrag: (event: PointerEvent<HTMLElement>) => void;
  selectedNodeId: string | null;
  selectedSlotId: string | null;
  zoom: number;
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
          connectionDropTarget={connectionDropTargetId === node.id}
          zoom={zoom}
          onNodeClick={onNodeClick}
          onSlotClick={onSlotClick}
          onStartConnection={onStartConnection}
          onCompleteConnection={onCompleteConnection}
          onStartConnectionDrag={onStartConnectionDrag}
          onMoveConnectionDrag={onMoveConnectionDrag}
          onEndConnectionDrag={onEndConnectionDrag}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        />
      ))}
    </>
  );
}
