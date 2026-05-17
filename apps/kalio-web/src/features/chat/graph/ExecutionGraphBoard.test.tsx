import { fireEvent, render, screen } from '@testing-library/react';
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

  it('renders cards with a fixed grid height so stacked tool nodes do not overlap', () => {
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    const turnNode = screen.getByTestId('graph-node-turn-1');

    expect(turnNode.style.height).toBe('80px');
  });

  it('translates the graph stage while dragging so panning is not limited by scroll boundaries', () => {
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    const viewport = screen.getByTestId('execution-graph-viewport');
    const stage = screen.getByTestId('execution-graph-stage');

    fireEvent.mouseDown(viewport, { button: 0, clientX: 200, clientY: 160 });
    fireEvent.mouseMove(viewport, { clientX: 278, clientY: 224 });

    expect(stage.style.transform).toContain('translate(78px, 64px)');
  });

  it('renders turn metadata as labeled fields so actor and model do not blend into the body copy', () => {
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getAllByText('RaBuilder').length).toBeGreaterThan(0);
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('gpt-4.1')).toBeInTheDocument();
  });

  it('shows a miniature preview inside preview-capable tool nodes', () => {
    const model = makeModel();
    model.nodes[1] = {
      ...model.nodes[1],
      payload: {
        kind: 'tool',
        toolName: 'design_preview',
        args: { filePath: 'calculator/index.html' },
        activity: null,
        result: {
          status: 'ready',
          type: 'html',
          content: '<main><h1>Calculator preview</h1></main>',
          vfsPath: 'calculator/index.html',
        },
        confirmationRequired: false,
      },
    };

    render(
      <ExecutionGraphBoard
        model={model}
        selectedNodeId="tool-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    expect(screen.getByTestId('graph-node-preview-tool-1')).toBeInTheDocument();
  });

  it('lets users drag nodes to custom positions', () => {
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    const node = screen.getByTestId('graph-node-turn-1');

    fireEvent.mouseDown(node, { button: 0, clientX: 40, clientY: 50 });
    fireEvent.mouseMove(document, { clientX: 95, clientY: 120 });
    fireEvent.mouseUp(document);

    expect(node.style.left).toBe('75px');
    expect(node.style.top).toBe('100px');
  });

  it('lets users resize nodes from the corner handle', () => {
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    const node = screen.getByTestId('graph-node-turn-1');
    const resizeHandle = screen.getByTestId('graph-node-resize-turn-1');

    fireEvent.mouseDown(resizeHandle, { button: 0, clientX: 140, clientY: 110 });
    fireEvent.mouseMove(document, { clientX: 210, clientY: 175 });
    fireEvent.mouseUp(document);

    expect(node.style.width).toBe('190px');
    expect(node.style.height).toBe('145px');
  });
});