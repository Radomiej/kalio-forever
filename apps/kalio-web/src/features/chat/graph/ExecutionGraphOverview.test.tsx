import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionGraphNode } from './executionGraphModel';
import { buildExecutionGraphOverviewModel, ExecutionGraphOverview } from './ExecutionGraphOverview';

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

describe('ExecutionGraphOverview', () => {
  it('builds a scaled node map and viewport rectangle from the shared graph camera', () => {
    const model = buildExecutionGraphOverviewModel({
      nodes: [
        node({ x: 20, y: 30, width: 120, height: 80 }),
        node({ id: 'node-2', x: 620, y: 430, width: 180, height: 100 }),
      ],
      pan: { x: 30, y: 26 },
      viewportHeight: 720,
      viewportWidth: 1280,
      zoom: 0.58,
    });

    expect(model).not.toBeNull();
    expect(model?.nodeRects).toHaveLength(2);
    expect(model?.viewportRect.width).toBeGreaterThan(6);
    expect(model?.viewportRect.height).toBeGreaterThan(6);
  });

  it('centers the graph from pointer interaction on the overview', () => {
    const onCenter = vi.fn();
    render(
      <ExecutionGraphOverview
        nodes={[
          node({ x: 20, y: 30, width: 120, height: 80 }),
          node({ id: 'node-2', x: 620, y: 430, width: 180, height: 100 }),
        ]}
        onCenter={onCenter}
        pan={{ x: 30, y: 26 }}
        viewportHeight={720}
        viewportWidth={1280}
        zoom={0.58}
      />,
    );

    const svg = screen.getByTestId('execution-graph-overview-svg');
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 176,
      bottom: 104,
      width: 176,
      height: 104,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(svg, { clientX: 88, clientY: 52, pointerId: 1 });

    expect(onCenter).toHaveBeenCalledWith(expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
    }));
  });
});
