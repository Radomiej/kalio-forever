import { useEffect, useRef, type RefObject } from 'react';
import { fitGraphPan, fitGraphZoom } from './ExecutionGraphBoard.geometry';
import type { ExecutionGraphNode } from './executionGraphModel';

export function useExecutionGraphFit({ viewportRef, nodes, zoom, resetToken, onFitZoom, setPan, resetInteraction }: {
  viewportRef: RefObject<HTMLDivElement | null>;
  nodes: ExecutionGraphNode[];
  zoom: number;
  resetToken: number;
  onFitZoom?: (value: number) => void;
  setPan: (value: { x: number; y: number }) => void;
  resetInteraction: () => void;
}) {
  const fitted = useRef(false);
  const consumedReset = useRef(0);

  useEffect(() => {
    const requested = consumedReset.current !== resetToken;
    if (fitted.current && !requested) return;
    const viewport = viewportRef.current;
    if (!viewport || nodes.length === 0) return;
    const { width: viewportWidth, height: viewportHeight } = viewport.getBoundingClientRect();
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      if (requested) {
        consumedReset.current = resetToken;
        setPan({ x: 0, y: 0 });
        resetInteraction();
      }
      return;
    }

    fitted.current = true;
    consumedReset.current = resetToken;
    const bounds = { nodes, viewportWidth, viewportHeight };
    const nextZoom = onFitZoom ? fitGraphZoom({ ...bounds, zoom, minZoom: Math.min(zoom, 0.58) }) : zoom;
    if (nextZoom < zoom) onFitZoom?.(nextZoom);
    setPan(fitGraphPan({ ...bounds, zoom: nextZoom }));
    if (requested) resetInteraction();
  }, [nodes, onFitZoom, resetInteraction, resetToken, setPan, viewportRef, zoom]);
}
