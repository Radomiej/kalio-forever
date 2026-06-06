import { describe, expect, it } from 'vitest';
import type { ExecutionGraphNode } from './executionGraphModel';
import {
  buildConnectorPreviewPath,
  buildEdgePath,
  clampGraphPan,
  fitGraphPan,
  fitGraphZoom,
  graphInteractionBounds,
  graphNodeBounds,
  nodeInputPoint,
  nodeOutputPoint,
} from './ExecutionGraphBoard.geometry';

function node(overrides: Partial<ExecutionGraphNode>): ExecutionGraphNode {
  return {
    id: 'node-1',
    kind: 'turn',
    title: 'Node',
    subtitle: '',
    status: 'success',
    column: 0,
    row: 0,
    x: 20,
    y: 30,
    width: 120,
    height: 80,
    payload: {
      kind: 'final-answer',
      message: null,
      turn: {} as never,
    },
    ...overrides,
  };
}

describe('ExecutionGraphBoard geometry', () => {
  it('anchors normal edges from the right side to the target input side', () => {
    const source = node({ x: 20, y: 30, width: 120, height: 80 });
    const target = node({ id: 'node-2', x: 220, y: 170, width: 120, height: 80 });

    expect(buildEdgePath(source, target)).toBe('M 140 70 C 180 70, 180 210, 220 210');
  });

  it('anchors downward tool branches from source bottom to target top', () => {
    const source = node({ x: 20, y: 30, width: 120, height: 80 });
    const target = node({ id: 'tool-1', kind: 'tool', x: 220, y: 170, width: 120, height: 80 });

    expect(buildEdgePath(source, target)).toBe('M 80 110 C 80 150, 280 130, 280 170');
  });

  it('builds connector preview paths from the active pin direction', () => {
    const source = node({ x: 20, y: 30, width: 120, height: 80 });

    expect(nodeInputPoint(source)).toEqual({ x: 20, y: 70 });
    expect(nodeOutputPoint(source)).toEqual({ x: 140, y: 70 });
    expect(buildConnectorPreviewPath(source, { x: 260, y: 160 }, 'output')).toBe('M 140 70 C 200 70, 200 160, 260 160');
    expect(buildConnectorPreviewPath(source, { x: -40, y: 20 }, 'input')).toBe('M -40 20 C 8 20, -28 70, 20 70');
  });

  it('computes bounds across all visible graph nodes', () => {
    expect(graphNodeBounds([
      node({ x: 20, y: 30, width: 120, height: 80 }),
      node({ id: 'node-2', x: 420, y: 150, width: 160, height: 90 }),
    ])).toEqual({
      minX: 20,
      minY: 30,
      maxX: 580,
      maxY: 240,
    });
  });

  it('expands fit bounds so connector pins are not clipped at the viewport edge', () => {
    expect(graphInteractionBounds([
      node({ x: 20, y: 30, width: 120, height: 80 }),
      node({ id: 'node-2', x: 420, y: 150, width: 160, height: 90 }),
    ])).toEqual({
      minX: 2,
      minY: 12,
      maxX: 598,
      maxY: 258,
    });
  });

  it('centers graphs that fit inside the viewport', () => {
    expect(fitGraphPan({
      nodes: [node({ x: 20, y: 30, width: 120, height: 80 })],
      viewportHeight: 360,
      viewportWidth: 640,
      zoom: 1,
    })).toEqual({ x: 240, y: 110 });
  });

  it('starts overflowing wide graphs at the leading padding so the first node is visible', () => {
    expect(fitGraphPan({
      nodes: [
        node({ x: 20, y: 30, width: 120, height: 80 }),
        node({ id: 'node-2', x: 1120, y: 130, width: 180, height: 100 }),
      ],
      viewportHeight: 420,
      viewportWidth: 900,
      zoom: 0.82,
    })).toEqual({ x: 30, y: 103 });
  });

  it('reduces zoom enough for wide graphs while respecting the graph zoom floor', () => {
    const nodes = [
      node({ x: 20, y: 30, width: 120, height: 80 }),
      node({ id: 'node-2', x: 1120, y: 130, width: 180, height: 100 }),
    ];

    expect(fitGraphZoom({
      minZoom: 0.55,
      nodes,
      viewportHeight: 420,
      viewportWidth: 900,
      zoom: 0.82,
    })).toBe(0.64);

    expect(fitGraphZoom({
      minZoom: 0.55,
      nodes,
      viewportHeight: 420,
      viewportWidth: 640,
      zoom: 0.82,
    })).toBe(0.55);
  });

  it('clamps extreme pan so the graph cannot be dragged fully out of view', () => {
    const nodes = [
      node({ x: 20, y: 30, width: 120, height: 80 }),
      node({ id: 'node-2', x: 420, y: 150, width: 160, height: 90 }),
    ];

    expect(clampGraphPan({
      nodes,
      pan: { x: 2000, y: -2000 },
      viewportHeight: 360,
      viewportWidth: 640,
      zoom: 1,
    })).toEqual({ x: 542, y: -162 });
  });
});
