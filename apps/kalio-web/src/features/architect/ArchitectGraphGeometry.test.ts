import { describe, expect, it } from 'vitest';
import {
  getNodeDimensions,
  inputPin,
  outputPin,
  PIN_ANCHOR_DEFAULT_ZOOM,
  pinHitboxSize,
  pinOutwardOffset,
} from './ArchitectGraphGeometry';
import type { ArchitectNode } from './architect.types';

describe('ArchitectGraphGeometry', () => {
  it('scales pin anchors with the measured node height instead of a fixed y offset', () => {
    const compact = makeNode({ slots: [] });
    const tall = makeNode({
      slots: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
        { id: 'd', label: 'D' },
      ],
    });

    expect(getNodeDimensions(tall).height).toBeGreaterThan(getNodeDimensions(compact).height);
    expect(inputPin(tall).y).toBe(tall.y + getNodeDimensions(tall).height / 2);
    expect(outputPin(tall).y).toBe(tall.y + getNodeDimensions(tall).height / 2);
    expect(inputPin(tall).y).toBeGreaterThan(inputPin(compact).y);
  });

  it('adds height for router and parallel behavior badges', () => {
    const plain = makeNode({ kind: 'router' });
    const withBehavior = makeNode({
      kind: 'router',
      behavior: { mode: 'rank_then_merge', fanOut: 'sequential' },
    });

    expect(getNodeDimensions(withBehavior).height).toBeGreaterThan(getNodeDimensions(plain).height);
    expect(outputPin(withBehavior).y).toBe(withBehavior.y + getNodeDimensions(withBehavior).pinY);
  });

  it('anchors pins outward from the card edge based on zoom-aware hitbox size', () => {
    const node = makeNode({ x: 120, y: 120 });
    const hitbox = pinHitboxSize(PIN_ANCHOR_DEFAULT_ZOOM);
    const outward = pinOutwardOffset(hitbox);

    expect(outputPin(node).x).toBe(node.x + 176 + outward);
    expect(inputPin(node).x).toBe(node.x - outward);
    expect(outputPin(node).x - inputPin(node).x).toBeCloseTo(176 + outward * 2);
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
