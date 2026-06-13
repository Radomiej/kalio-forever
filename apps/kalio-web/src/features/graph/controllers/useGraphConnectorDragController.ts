import { useCallback, useRef, useState, type PointerEvent } from 'react';
import {
  acquirePointerCaptureIfSupported,
  hasGraphDragStarted,
  releasePointerCaptureIfHeld,
  type GraphViewportPoint,
} from '../useGraphInteraction';
import type { GraphConnectorDragControllerOptions } from './graphController.types';

export function useGraphConnectorDragController<
  TState extends {
    sourceNodeId: string;
    direction?: string;
    moved: boolean;
    pointerId: number;
    startX: number;
    startY: number;
  },
>({
  adapter,
  createDragState,
}: GraphConnectorDragControllerOptions<TState>) {
  const dragRef = useRef<TState | null>(null);
  const [draggingConnector, setDraggingConnector] = useState<{
    sourceNodeId: string;
    direction?: string;
    targetNodeId: string | null;
    previewPoint: GraphViewportPoint;
  } | null>(null);

  const resetConnector = useCallback(() => {
    dragRef.current = null;
    setDraggingConnector(null);
  }, []);

  type ConnectorDragMeta = Omit<TState, 'moved' | 'pointerId' | 'startX' | 'startY'>;

  const onPointerDown = useCallback((
    event: PointerEvent<HTMLElement>,
    meta: ConnectorDragMeta,
  ) => {
    if (adapter.canStart && !adapter.canStart(event)) {
      return;
    }
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId ?? 0;
    acquirePointerCaptureIfSupported(event.currentTarget, pointerId);
    dragRef.current = createDragState(event, meta);
  }, [createDragState]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const dragState = dragRef.current;
    const pointerId = event.pointerId ?? 0;
    if (!dragState || dragState.pointerId !== pointerId) {
      return;
    }

    if (!dragState.moved && !hasGraphDragStarted({
      startX: dragState.startX,
      startY: dragState.startY,
      clientX: event.clientX,
      clientY: event.clientY,
    })) {
      return;
    }

    const point = adapter.clientToPreviewPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragState.moved = true;
    const targetNodeId = adapter.resolveDropTarget(event.clientX, event.clientY, dragState);
    setDraggingConnector({
      sourceNodeId: dragState.sourceNodeId,
      direction: dragState.direction,
      targetNodeId,
      previewPoint: point,
    });
    adapter.onPreview?.(point, targetNodeId);
    adapter.applyAutoPan(event.clientX, event.clientY);
  }, [adapter]);

  const onPointerUp = useCallback((event: PointerEvent<HTMLElement>) => {
    const dragState = dragRef.current;
    const pointerId = event.pointerId ?? 0;
    if (!dragState || dragState.pointerId !== pointerId) {
      return;
    }
    releasePointerCaptureIfHeld(event.currentTarget, pointerId);
    const targetNodeId = dragState.moved
      ? adapter.resolveDropTarget(event.clientX, event.clientY, dragState)
      : null;
    adapter.onCommit(dragState.sourceNodeId, targetNodeId, dragState.moved);
    resetConnector();
  }, [adapter, resetConnector]);

  const onPointerCancel = onPointerUp;

  return {
    draggingConnector,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
    resetConnector,
  };
}
