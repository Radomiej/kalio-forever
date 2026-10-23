import { useEffect, useRef, useState, type MouseEvent } from 'react';

const DEFAULT_ZOOM = 0.82;
const clampZoom = (value: number) => Math.max(0.58, Math.min(1.6, Number(value.toFixed(2))));

export function useExecutionGraphViewport() {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [inspectorWidth, setInspectorWidth] = useState(280);
  const [resetViewportToken, setResetViewportToken] = useState(0);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  useEffect(() => {
    const move = (event: globalThis.MouseEvent) => {
      if (resizeRef.current) setInspectorWidth(Math.max(280, Math.min(500,
        resizeRef.current.startWidth + resizeRef.current.startX - event.clientX)));
    };
    const stop = () => { resizeRef.current = null; };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stop);
    return () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', stop); };
  }, []);
  const resetZoom = () => { setZoom(DEFAULT_ZOOM); setResetViewportToken((value) => value + 1); };
  return {
    zoom, setZoom, inspectorWidth, resetViewportToken, resetZoom, fitAll: resetZoom,
    collapseTools: zoom <= 0.85,
    decreaseZoom: () => setZoom((value) => clampZoom(value - 0.15)),
    increaseZoom: () => setZoom((value) => clampZoom(value + 0.15)),
    handleWheelZoom: (deltaY: number) => {
      if (deltaY === 0) return zoom;
      const next = clampZoom(zoom + (deltaY < 0 ? 0.15 : -0.15));
      setZoom(next);
      return next;
    },
    startInspectorResize: (event: MouseEvent<HTMLDivElement>) => {
      resizeRef.current = { startX: event.clientX, startWidth: inspectorWidth };
    },
  };
}
