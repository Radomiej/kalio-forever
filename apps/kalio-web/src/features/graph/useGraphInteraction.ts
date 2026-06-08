import { useCallback, useEffect, useState, type RefObject } from 'react';

export const GRAPH_MOUSE_FALLBACK_POINTER_ID = -1;
export const GRAPH_DRAG_START_THRESHOLD_PX = 5;

export type GraphPanStart = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

export type GraphCamera = {
  pan: { x: number; y: number };
  zoom: number;
};

export type GraphViewportPoint = {
  x: number;
  y: number;
};

export function nextGraphPan(start: GraphPanStart, clientX: number, clientY: number) {
  return {
    x: start.originX + (clientX - start.startX),
    y: start.originY + (clientY - start.startY),
  };
}

export function graphPointerDistance({
  clientX,
  clientY,
  startX,
  startY,
}: {
  clientX: number;
  clientY: number;
  startX: number;
  startY: number;
}): number {
  return Math.hypot(clientX - startX, clientY - startY);
}

export function hasGraphDragStarted({
  clientX,
  clientY,
  startX,
  startY,
  thresholdPx = GRAPH_DRAG_START_THRESHOLD_PX,
}: {
  clientX: number;
  clientY: number;
  startX: number;
  startY: number;
  thresholdPx?: number;
}): boolean {
  return graphPointerDistance({ clientX, clientY, startX, startY }) >= thresholdPx;
}

export function graphWorldDeltaFromClientDelta({
  clientX,
  clientY,
  startX,
  startY,
  zoom,
}: {
  clientX: number;
  clientY: number;
  startX: number;
  startY: number;
  zoom: number;
}): GraphViewportPoint {
  return {
    x: (clientX - startX) / zoom,
    y: (clientY - startY) / zoom,
  };
}

export function nextGraphCameraPanForZoom({
  focalX,
  focalY,
  pan,
  zoom,
  nextZoom,
}: {
  focalX: number;
  focalY: number;
  pan: { x: number; y: number };
  zoom: number;
  nextZoom: number;
}) {
  const worldX = (focalX - pan.x) / zoom;
  const worldY = (focalY - pan.y) / zoom;
  return {
    x: Math.round(focalX - worldX * nextZoom),
    y: Math.round(focalY - worldY * nextZoom),
  };
}

export function nextGraphPanForZoom({
  focalPoint,
  camera,
  nextZoom,
}: {
  focalPoint: GraphViewportPoint;
  camera: GraphCamera;
  nextZoom: number;
}) {
  return nextGraphCameraPanForZoom({
    focalX: focalPoint.x,
    focalY: focalPoint.y,
    pan: camera.pan,
    zoom: camera.zoom,
    nextZoom,
  });
}

export function nextGraphPanForAutoPan({
  bounds,
  clientX,
  clientY,
  edgeSize = 56,
  pan,
  step = 28,
}: {
  bounds: Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>;
  clientX: number;
  clientY: number;
  edgeSize?: number;
  pan: { x: number; y: number };
  step?: number;
}) {
  let deltaX = 0;
  let deltaY = 0;

  if (clientX >= bounds.left && clientX - bounds.left < edgeSize) {
    deltaX = step;
  } else if (clientX <= bounds.right && bounds.right - clientX < edgeSize) {
    deltaX = -step;
  }

  if (clientY >= bounds.top && clientY - bounds.top < edgeSize) {
    deltaY = step;
  } else if (clientY <= bounds.bottom && bounds.bottom - clientY < edgeSize) {
    deltaY = -step;
  }

  if (deltaX === 0 && deltaY === 0) {
    return pan;
  }

  return {
    x: pan.x + deltaX,
    y: pan.y + deltaY,
  };
}

export function graphViewportPointFromClient(bounds: DOMRect, clientX: number, clientY: number): GraphViewportPoint {
  return {
    x: clientX - bounds.left,
    y: clientY - bounds.top,
  };
}

export function graphViewportCenter(bounds: DOMRect): GraphViewportPoint {
  return {
    x: bounds.width / 2,
    y: bounds.height / 2,
  };
}

export function graphWorldPointFromClient({
  bounds,
  camera,
  clientX,
  clientY,
}: {
  bounds: DOMRect;
  camera: GraphCamera;
  clientX: number;
  clientY: number;
}): GraphViewportPoint {
  const viewportPoint = graphViewportPointFromClient(bounds, clientX, clientY);
  return {
    x: (viewportPoint.x - camera.pan.x) / camera.zoom,
    y: (viewportPoint.y - camera.pan.y) / camera.zoom,
  };
}

export function graphViewportClassName({
  dragging,
  extraClassName = '',
}: {
  dragging: boolean;
  extraClassName?: string;
}): string {
  return [
    'overflow-hidden overscroll-none select-none touch-none',
    'bg-[linear-gradient(rgba(56,189,248,0.055)_1px,_transparent_1px),linear-gradient(90deg,_rgba(56,189,248,0.055)_1px,_transparent_1px)]',
    'bg-[length:40px_40px] bg-[#08111f]',
    dragging ? 'cursor-grabbing' : 'cursor-grab',
    extraClassName,
  ].filter(Boolean).join(' ');
}

export function useGraphViewport({
  initialPan = { x: 0, y: 0 },
  initialZoom = 1,
}: {
  initialPan?: GraphCamera['pan'];
  initialZoom?: number;
} = {}) {
  const [pan, setPan] = useState(initialPan);
  const [zoom, setZoom] = useState(initialZoom);

  const setCamera = useCallback((camera: GraphCamera) => {
    setPan(camera.pan);
    setZoom(camera.zoom);
  }, []);

  const zoomTo = useCallback((nextZoom: number, focalPoint?: GraphViewportPoint) => {
    if (nextZoom === zoom) {
      return;
    }
    setZoom(nextZoom);
    setPan(nextGraphPanForZoom({
      focalPoint: focalPoint ?? { x: 0, y: 0 },
      camera: { pan, zoom },
      nextZoom,
    }));
  }, [pan, zoom]);

  const clientToWorld = useCallback((bounds: DOMRect, clientX: number, clientY: number) => graphWorldPointFromClient({
    bounds,
    camera: { pan, zoom },
    clientX,
    clientY,
  }), [pan, zoom]);

  return {
    camera: { pan, zoom },
    clientToWorld,
    pan,
    setCamera,
    setPan,
    setZoom,
    zoom,
    zoomTo,
  };
}

export function shouldStartGraphPan({
  blockedSelector,
  button,
  forcePan = false,
  target,
}: {
  blockedSelector?: string;
  button: number;
  forcePan?: boolean;
  target: EventTarget;
}): boolean {
  if (button !== 0 && button !== 1) {
    return false;
  }
  if (forcePan) {
    return true;
  }

  const element = target instanceof Element ? target : null;
  return !blockedSelector || !element?.closest(blockedSelector);
}

export function hasPointerEvents(): boolean {
  return typeof window !== 'undefined' && 'PointerEvent' in window;
}

export function releasePointerCaptureIfHeld(element: Element, pointerId: number): void {
  if (
    'hasPointerCapture' in element
    && 'releasePointerCapture' in element
    && typeof element.hasPointerCapture === 'function'
    && typeof element.releasePointerCapture === 'function'
    && element.hasPointerCapture(pointerId)
  ) {
    element.releasePointerCapture(pointerId);
  }
}

export function useSpacePanning(): boolean {
  const [spacePanning, setSpacePanning] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      const shouldIgnore = target instanceof HTMLElement
        && Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
      if (event.key === ' ' && !shouldIgnore) {
        event.preventDefault();
        setSpacePanning(true);
      }
    };
    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === ' ') {
        setSpacePanning(false);
      }
    };
    const handleBlur = () => setSpacePanning(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  return spacePanning;
}

export function useGraphWheelListener<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onWheel: (event: WheelEvent, element: T) => void,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }

    const handleWheel = (event: WheelEvent) => onWheel(event, element);
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [onWheel, ref]);
}
