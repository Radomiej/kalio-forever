import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionGraphModel } from './executionGraphModel';
import { ExecutionGraphBoard } from './ExecutionGraphBoard';

const noop = vi.fn();

function makeModel(): ExecutionGraphModel {
  return {
    nodes: [
      {
        id: 'turn-1',
        kind: 'turn',
        title: 'Turn',
        subtitle: 'RaBuilder',
        status: 'success',
        column: 0,
        row: 0,
        x: 20,
        y: 30,
        width: 120,
        height: 80,
        payload: {
          kind: 'turn',
          turn: {} as never,
          textPreview: 'Built the calculator.',
          toolCount: 2,
          thinkingCount: 1,
          actorLabel: 'RaBuilder',
          modelLabel: 'gpt-4.1',
        },
      },
      {
        id: 'tool-1',
        kind: 'tool',
        title: 'design_preview',
        subtitle: 'Execution step',
        status: 'success',
        column: 1,
        row: 1,
        x: 220,
        y: 170,
        width: 120,
        height: 80,
        callId: 'tool-1',
        payload: {
          kind: 'tool',
          toolName: 'design_preview',
          args: { filePath: 'calculator/index.html' },
          activity: null,
          result: null,
          confirmationRequired: false,
        },
      },
    ],
    edges: [
      {
        id: 'turn-1->tool-1:solid',
        sourceId: 'turn-1',
        targetId: 'tool-1',
        style: 'solid',
      },
    ],
    board: { width: 420, height: 360 },
    defaultSelectedNodeId: 'turn-1',
  };
}

describe('ExecutionGraphBoard', () => {
  it('anchors tool edges from the bottom of the source node instead of the right edge', () => {
    const { container } = render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    const edgePath = container.querySelector('path[marker-end="url(#graph-arrow)"]');

    expect(edgePath?.getAttribute('d')).toMatch(/^M 80 110 /);
  });

  it('keeps the graph canvas stretched to the available viewport when the graph is smaller', () => {
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    const viewport = screen.getByTestId('execution-graph-viewport');

    expect(viewport.firstElementChild).toHaveClass('min-w-full');
    expect(viewport.firstElementChild).toHaveClass('min-h-full');
  });
});