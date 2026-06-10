import { useCallback, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import {
  acquirePointerCaptureIfSupported,
  GRAPH_MOUSE_FALLBACK_POINTER_ID,
  hasPointerEvents,
  nextGraphPan,
  releasePointerCaptureIfHeld,
  shouldStartGraphPan,
  type GraphPanStart,
  type GraphViewportPoint,
} from '../useGraphInteraction';
import type { GraphPanControllerOptions } from './graphController.types';

const defaultResolveForcePan = (event: { altKey: boolean; button: number }) => event.altKey || event.button === 1;

export function useGraphPanController({
  pan,
  setPan,
  spacePanning,
  blockedSelector,
  clampPan,
  useMouseFallback = !hasPointerEvents(),
  resolveForcePan = defaultResolveForcePan,
}: GraphPanControllerOptions) {
  const panningRef = useRef<GraphPanStart | null>(null);
  const [dragging, setDragging] = useState(false);

  const applyPan = useCallback((next: GraphViewportPoint) => {
    setPan(clampPan ? clampPan(next) : next);
  }, [clampPan, setPan]);

  const resetPan = useCallback(() => {
    panningRef.current = null;
    setDragging(false);
  }, []);

  const startPanFromEvent = useCallback((event: {
    altKey: boolean;
    button: number;
    clientX: number;
    clientY: number;
    pointerId: number;
    target: EventTarget;
    currentTarget: Element;
    preventDefault: () => void;
  }) => {
    if (!shouldStartGraphPan({
      blockedSelector,
      button: event.button,
      forcePan: spacePanning || resolveForcePan(event),
      target: event.target,
    })) {
      return;
    }
    event.preventDefault();
    acquirePointerCaptureIfSupported(event.currentTarget, event.pointerId);
    panningRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
    setDragging(true);
  }, [blockedSelector, pan.x, pan.y, resolveForcePan, spacePanning]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    startPanFromEvent({
      altKey: event.altKey,
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId ?? 0,
      target: event.target,
      currentTarget: event.currentTarget,
      preventDefault: () => event.preventDefault(),
    });
  }, [startPanFromEvent]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    const panning = panningRef.current;
    if (!panning || pointerId !== panning.pointerId) {
      return;
    }
    applyPan(nextGraphPan(panning, event.clientX, event.clientY));
  }, [applyPan]);

  const onPointerUp = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    const panning = panningRef.current;
    if (!panning || pointerId !== panning.pointerId) {
      return;
    }
    releasePointerCaptureIfHeld(event.currentTarget, pointerId);
    resetPan();
  }, [resetPan]);

  const onPointerCancel = onPointerUp;

  const onMouseDown = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!useMouseFallback) {
      return;
    }
    startPanFromEvent({
      altKey: event.altKey,
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: GRAPH_MOUSE_FALLBACK_POINTER_ID,
      target: event.target,
      currentTarget: event.currentTarget,
      preventDefault: () => event.preventDefault(),
    });
  }, [startPanFromEvent, useMouseFallback]);

  const onMouseMove = useCallback((event: MouseEvent<HTMLElement>) => {
    const panning = panningRef.current;
    if (!panning || panning.pointerId !== GRAPH_MOUSE_FALLBACK_POINTER_ID) {
      return;
    }
    applyPan(nextGraphPan(panning, event.clientX, event.clientY));
  }, [applyPan]);

  const onMouseUp = useCallback(() => {
    if (panningRef.current?.pointerId === GRAPH_MOUSE_FALLBACK_POINTER_ID) {
      resetPan();
    }
  }, [resetPan]);

  const onMouseLeave = onMouseUp;

  return {
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      ...(useMouseFallback ? {
        onMouseDown,
        onMouseMove,
        onMouseUp,
        onMouseLeave,
      } : {}),
    },
    resetPan,
  };
}
