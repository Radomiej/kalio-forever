import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM, fitArchitectGraphViewport, nextArchitectZoom } from './ArchitectGraphCanvas.model';
import type { ArchitectNode } from './architect.types';

describe('ArchitectGraphCanvas model', () => {
  it('fits a graph inside the viewport and centers the node bounds', () => {
    const nodes: ArchitectNode[] = [
      { id: 'a', label: 'A', kind: 'role', x: 100, y: 80, slots: [], connections: [] },
      { id: 'b', label: 'B', kind: 'artifact', x: 700, y: 420, slots: [], connections: [] },
    ];

    expect(fitArchitectGraphViewport({
      nodes,
      viewportHeight: 600,
      viewportWidth: 900,
    })).toEqual({
      pan: { x: 50, y: 52 },
      zoom: DEFAULT_ZOOM,
    });
  });

  it('reduces zoom for wide graphs instead of pinning reset to the origin', () => {
    const nodes: ArchitectNode[] = [
      { id: 'a', label: 'A', kind: 'role', x: 0, y: 0, slots: [], connections: [] },
      { id: 'b', label: 'B', kind: 'artifact', x: 1600, y: 0, slots: [], connections: [] },
    ];

    const result = fitArchitectGraphViewport({
      nodes,
      viewportHeight: 500,
      viewportWidth: 900,
    });

    expect(result.zoom).toBeLessThan(DEFAULT_ZOOM);
    expect(result.pan.x).not.toBe(0);
  });

  it('uses proportional zoom steps so higher zoom levels do not feel sluggish', () => {
    const lowZoomStep = nextArchitectZoom(0.82, 'in') - 0.82;
    const highZoomStep = nextArchitectZoom(1.4, 'in') - 1.4;

    expect(nextArchitectZoom(0.82, 'in')).toBe(0.92);
    expect(nextArchitectZoom(0.92, 'out')).toBe(0.82);
    expect(highZoomStep).toBeGreaterThan(lowZoomStep);
  });
});
