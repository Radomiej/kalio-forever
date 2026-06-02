import { describe, expect, it } from 'vitest';
import { getNodeDimensions, inputPin, outputPin } from './ArchitectGraphGeometry';
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
