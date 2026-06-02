import { describe, expect, it } from 'vitest';
import { layoutGraphNodes, layoutMissingNodePositions } from './ArchitectGraphLayout';
import type { ArchitectNode } from './architect.types';

describe('layoutGraphNodes', () => {
  it('centers parallel fan-out and fan-in around the middle branch', () => {
    const nodes: ArchitectNode[] = [
      makeNode('source', 'Parallel', 'parallel'),
      makeNode('a', 'A', 'role'),
      makeNode('b', 'B', 'role'),
      makeNode('c', 'C', 'role'),
      makeNode('merge', 'Merge', 'router'),
    ];

    const layout = layoutGraphNodes(nodes, [
      { id: 'source-a', fromNodeId: 'source', toNodeId: 'a' },
      { id: 'source-b', fromNodeId: 'source', toNodeId: 'b' },
      { id: 'source-c', fromNodeId: 'source', toNodeId: 'c' },
      { id: 'a-merge', fromNodeId: 'a', toNodeId: 'merge' },
      { id: 'b-merge', fromNodeId: 'b', toNodeId: 'merge' },
      { id: 'c-merge', fromNodeId: 'c', toNodeId: 'merge' },
    ]);

    const source = find(layout, 'source');
    const a = find(layout, 'a');
    const b = find(layout, 'b');
    const c = find(layout, 'c');
    const merge = find(layout, 'merge');

    expect(source.y).toBe(b.y);
    expect(merge.y).toBe(b.y);
    expect(a.y).toBeLessThan(b.y);
    expect(c.y).toBeGreaterThan(b.y);
    expect(a.x).toBe(b.x);
    expect(b.x).toBe(c.x);
    expect(merge.x).toBeGreaterThan(b.x);
  });

  it('preserves positioned nodes while centering only missing nodes', () => {
    const nodes: ArchitectNode[] = [
      makeNode('source', 'Parallel', 'parallel', 40, 50),
      makeNode('a', 'A', 'role'),
      makeNode('b', 'B', 'role', 700, 710),
      makeNode('merge', 'Merge', 'router'),
    ];

    const layout = layoutMissingNodePositions(nodes, [
      { id: 'source-a', fromNodeId: 'source', toNodeId: 'a' },
      { id: 'source-b', fromNodeId: 'source', toNodeId: 'b' },
      { id: 'a-merge', fromNodeId: 'a', toNodeId: 'merge' },
      { id: 'b-merge', fromNodeId: 'b', toNodeId: 'merge' },
    ], new Set(['a', 'merge']));

    expect(find(layout, 'source')).toMatchObject({ x: 40, y: 50 });
    expect(find(layout, 'b')).toMatchObject({ x: 700, y: 710 });
    expect(find(layout, 'a')).toMatchObject({ x: 360, y: 120 });
    expect(find(layout, 'merge')).toMatchObject({ x: 600, y: 186 });
  });
});

function makeNode(id: string, label: string, kind: ArchitectNode['kind'], x = 0, y = 0): ArchitectNode {
  return {
    id,
    label,
    kind,
    x,
    y,
    slots: [],
    connections: [],
  };
}

function find(nodes: ArchitectNode[], id: string): ArchitectNode {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) {
    throw new Error(`Missing node ${id}`);
  }
  return node;
}
