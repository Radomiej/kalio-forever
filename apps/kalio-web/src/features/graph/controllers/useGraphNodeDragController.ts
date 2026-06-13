import { useCallback, useRef, useState, type PointerEvent } from 'react';
import {
  acquirePointerCaptureIfSupported,
  graphWorldDeltaFromClientDelta,
  hasGraphDragStarted,
  releasePointerCaptureIfHeld,
} from '../useGraphInteraction';
import type { GraphNodeDragControllerOptions, GraphNodeDragState } from './graphController.types';

export function useGraphNodeDragController<TNode>({
  zoom,
  spacePanning,
  adapter,
}: GraphNodeDragControllerOptions<TNode>) {
  const dragRef = useRef<GraphNodeDragState | null>(null);
  const suppressNextClickRef = useRef(false);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

  const resetDrag = useCallback(() => {
    dragRef.current = null;
    setDraggingNodeId(null);
  }, []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>, node: TNode & { id: string }) => {
    if (adapter.canStartDrag && !adapter.canStartDrag(event, node)) {
      return;
    }
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }
    if (spacePanning || event.altKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId ?? 0;
    acquirePointerCaptureIfSupported(event.currentTarget, pointerId);
    const origin = adapter.getNodeOrigin(node);
    adapter.onSelectOnStart?.(node.id);
    dragRef.current = {
      nodeId: node.id,
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      moved: false,
    };
    setDraggingNodeId(node.id);
  }, [adapter, spacePanning]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const dragState = dragRef.current;
    const pointerId = event.pointerId ?? 0;
    if (!dragState || pointerId !== dragState.pointerId) {
      return;
    }

    event.preventDefault();
    const moved = dragState.moved || hasGraphDragStarted({
      startX: dragState.startX,
      startY: dragState.startY,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    if (!moved) {
      return;
    }

    if (!dragState.moved) {
      dragState.moved = true;
    }

    const delta = graphWorldDeltaFromClientDelta({
      startX: dragState.startX,
      startY: dragState.startY,
      clientX: event.clientX,
      clientY: event.clientY,
      zoom,
    });
    adapter.commitPosition(dragState.nodeId, {
      x: dragState.originX + delta.x,
      y: dragState.originY + delta.y,
    });
  }, [adapter, zoom]);

  const onPointerUp = useCallback((event: PointerEvent<HTMLElement>) => {
    const dragState = dragRef.current;
    const pointerId = event.pointerId ?? 0;
    if (!dragState || pointerId !== dragState.pointerId) {
      return;
    }
    releasePointerCaptureIfHeld(event.currentTarget, pointerId);
    if (dragState.moved) {
      suppressNextClickRef.current = true;
    }
    resetDrag();
  }, [resetDrag]);

  const onPointerCancel = onPointerUp;

  const consumeSuppressNextClick = useCallback(() => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return true;
    }
    return false;
  }, []);

  return {
    draggingNodeId,
    draggingNode: dragRef.current,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
    resetDrag,
    consumeSuppressNextClick,
  };
}
