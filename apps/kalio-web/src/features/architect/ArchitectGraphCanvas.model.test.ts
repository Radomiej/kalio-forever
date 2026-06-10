import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM, FIT_PADDING, fitArchitectGraphViewport } from './ArchitectGraphCanvas.model';
import { NODE_WIDTH, PIN_ANCHOR_DEFAULT_ZOOM, pinHitboxSize, pinOutwardOffset } from './ArchitectGraphGeometry';
import type { ArchitectNode } from './architect.types';

describe('fitArchitectGraphViewport', () => {
  it('reduces zoom when outward connector anchor offsets would otherwise clip in a narrow viewport', () => {
    const node = makeNode({ x: 100, y: 120 });
    const outward = pinOutwardOffset(pinHitboxSize(PIN_ANCHOR_DEFAULT_ZOOM));
    const viewportWidth = Math.floor(NODE_WIDTH * DEFAULT_ZOOM + FIT_PADDING * 2 + outward);
    const viewport = fitArchitectGraphViewport({
      nodes: [node],
      viewportWidth,
      viewportHeight: 400,
    });

    expect(viewport.zoom).toBeLessThan(DEFAULT_ZOOM);
  });
});

function makeNode(overrides: Partial<ArchitectNode> = {}): ArchitectNode {
  return {
    id: 'node',
    label: 'Node',
    kind: 'role',
    x: 100,
    y: 120,
    slots: [],
    connections: [],
    ...overrides,
  };
}
