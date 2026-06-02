import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@kalio/types';
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
          thinkingPreviews: [],
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
  it('renders prompt roots, dashed fallback edges, and final responses while preserving node selection clicks', () => {
    const promptMessage = {
      id: 'prompt-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'Draft the execution graph.',
      createdAt: 1,
    } as ChatMessage;
    const finalMessage = {
      id: 'reply-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'Done.',
      createdAt: 4,
    } as ChatMessage;

    const model: ExecutionGraphModel = {
      nodes: [
        {
          id: 'prompt:prompt-1',
          kind: 'prompt',
          title: 'Prompt',
          subtitle: 'Draft the execution graph.',
          status: 'success',
          column: 0,
          row: 0,
          x: 20,
          y: 24,
          width: 140,
          height: 84,
          sessionId: 'session-1',
          payload: {
            kind: 'prompt',
            message: promptMessage,
          },
        },
        {
          id: 'turn:turn-1',
          kind: 'turn',
          title: 'Turn',
          subtitle: 'RaBuilder',
          status: 'running',
          column: 1,
          row: 1,
          x: 208,
          y: 140,
          width: 156,
          height: 92,
          sessionId: 'session-1',
          turnId: 'turn-1',
          payload: {
            kind: 'turn',
            turn: { id: 'turn-1', sessionId: 'session-1', promptMessageId: 'prompt-1', done: false, items: [] } as never,
            textPreview: null,
            toolCount: 1,
            thinkingCount: 0,
            thinkingPreviews: [],
            actorLabel: 'RaBuilder',
            modelLabel: 'gpt-4.1',
          },
        },
        {
          id: 'tool:call-1',
          kind: 'tool',
          title: 'run_subagent',
          subtitle: 'Awaiting confirmation',
          status: 'running',
          column: 2,
          row: 2,
          x: 404,
          y: 260,
          width: 150,
          height: 96,
          callId: 'call-1',
          payload: {
            kind: 'tool',
            toolName: 'run_subagent',
            args: { objective: 'Review graph visibility' },
            activity: null,
            result: null,
            confirmationRequired: true,
          },
        },
        {
          id: 'tool-result:call-1',
          kind: 'tool-result',
          title: 'Unparsed child result',
          subtitle: 'run_subagent',
          status: 'error',
          column: 3,
          row: 3,
          x: 596,
          y: 376,
          width: 162,
          height: 108,
          callId: 'call-1',
          payload: {
            kind: 'tool-result',
            toolName: 'run_subagent',
            result: { childSessionId: 'child-session-1', status: 'done' },
            reason: 'Unrecognized child-agent result shape',
          },
        },
        {
          id: 'final:turn-1',
          kind: 'final-answer',
          title: 'Final response',
          subtitle: 'Last chat reply',
          status: 'success',
          column: 4,
          row: 4,
          x: 796,
          y: 492,
          width: 168,
          height: 100,
          turnId: 'turn-1',
          payload: {
            kind: 'final-answer',
            message: finalMessage,
            turn: { id: 'turn-1', sessionId: 'session-1', promptMessageId: 'prompt-1', done: true, items: [] } as never,
          },
        },
      ],
      edges: [
        { id: 'prompt:prompt-1->turn:turn-1:solid', sourceId: 'prompt:prompt-1', targetId: 'turn:turn-1', style: 'solid' },
        { id: 'turn:turn-1->tool:call-1:solid', sourceId: 'turn:turn-1', targetId: 'tool:call-1', style: 'solid' },
        { id: 'tool:call-1->tool-result:call-1:dashed', sourceId: 'tool:call-1', targetId: 'tool-result:call-1', style: 'dashed' },
        { id: 'tool-result:call-1->final:turn-1:solid', sourceId: 'tool-result:call-1', targetId: 'final:turn-1', style: 'solid' },
      ],
      board: { width: 1120, height: 760 },
      defaultSelectedNodeId: 'prompt:prompt-1',
    };

    const onSelectNode = vi.fn();
    const { container } = render(
      <ExecutionGraphBoard
        model={model}
        selectedNodeId="prompt:prompt-1"
        onSelectNode={onSelectNode}
        zoom={1}
      />,
    );

    expect(screen.getByTestId('graph-node-prompt:prompt-1')).toHaveTextContent('Prompt');
    expect(screen.getByTestId('graph-node-turn:turn-1')).toHaveTextContent('running');
    expect(screen.getByTestId('graph-node-final:turn-1')).toHaveTextContent('ready');
    expect(screen.getByTestId('graph-edge-tool:call-1->tool-result:call-1:dashed')).toHaveAttribute('stroke-dasharray', '7 8');

    fireEvent.click(screen.getByTestId('graph-node-turn:turn-1'));

    expect(onSelectNode).toHaveBeenCalledWith('turn:turn-1');
    expect(container.querySelector('path[marker-end="url(#graph-arrow)"]')).not.toBeNull();
  });

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

  it('shrinks the stage layout box when zoomed out so fitted graphs do not report offscreen content', () => {
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={0.55}
      />,
    );

    const stage = screen.getByTestId('execution-graph-stage');

    expect(parseFloat(stage.style.width)).toBeCloseTo(231);
    expect(parseFloat(stage.style.height)).toBeCloseTo(198);
    expect(stage.style.transform).toBe('translate(0px, 0px)');
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

  it('does not start panning when a graph node receives the initial press', () => {
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

    fireEvent.mouseDown(screen.getByTestId('graph-node-turn-1'), { button: 0, clientX: 200, clientY: 160 });
    fireEvent.mouseMove(viewport, { clientX: 278, clientY: 224 });

    expect(stage.style.transform).toBe('translate(0px, 0px)');
  });

  it('clears the dragging state when the pointer leaves the graph viewport', () => {
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    const viewport = screen.getByTestId('execution-graph-viewport');

    fireEvent.mouseDown(viewport, { button: 0, clientX: 200, clientY: 160 });
    expect(viewport).toHaveClass('cursor-grabbing');

    fireEvent.mouseLeave(viewport);

    expect(viewport).toHaveClass('cursor-grab');
  });

  it('uses a non-passive native wheel listener so zoom prevents page scroll', () => {
    const onWheelZoom = vi.fn();
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        onWheelZoom={onWheelZoom}
        zoom={1}
      />,
    );

    const viewport = screen.getByTestId('execution-graph-viewport');
    const wheelEvent = new WheelEvent('wheel', { cancelable: true, deltaY: -120 });
    viewport.dispatchEvent(wheelEvent);

    expect(onWheelZoom).toHaveBeenCalledWith(-120);
    expect(wheelEvent.defaultPrevented).toBe(true);
  });

  it('renders turn metadata as labeled fields so actor and model do not blend into the body copy', () => {
    render(
      <ExecutionGraphBoard
        cardDensity="detailed"
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

  it('renders explicit input and output pins on router route nodes', () => {
    const model = makeModel();
    model.nodes[1] = {
      ...model.nodes[1],
      id: 'architecture-route:reply-1:0',
      kind: 'architecture-run',
      title: 'Router',
      subtitle: 'agent-1 -> final-artifact',
      payload: {
        kind: 'architecture-run',
        summary: {
          runId: 'run-1',
          schemaId: 'goal-master-delivery-loop',
          status: 'completed',
          trace: [],
          routeHops: [],
        },
        route: {
          eventId: 'event-router',
          source: 'router',
          fromNodeId: 'agent-1',
          toNodeId: 'final-artifact',
        },
      },
    };

    render(
      <ExecutionGraphBoard
        model={model}
        selectedNodeId="architecture-route:reply-1:0"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    expect(screen.getByTestId('graph-node-router-input-pin-architecture-route:reply-1:0')).toBeInTheDocument();
    expect(screen.getByTestId('graph-node-router-output-pin-architecture-route:reply-1:0')).toBeInTheDocument();
    expect(screen.getByTestId('graph-node-architecture-route:reply-1:0')).toHaveClass('border-amber-300/35');
  });

  it('renders input and output pins on regular execution graph nodes', () => {
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    expect(screen.getByTestId('graph-node-input-pin-turn-1')).toBeInTheDocument();
    expect(screen.getByTestId('graph-node-output-pin-turn-1')).toBeInTheDocument();
    expect(screen.getByTestId('graph-node-input-pin-tool-1')).toBeInTheDocument();
    expect(screen.getByTestId('graph-node-output-pin-tool-1')).toBeInTheDocument();
  });

  it('uses compact card density by default so tool argument metadata does not dominate the graph', () => {
    const model = makeModel();
    model.nodes[1] = {
      ...model.nodes[1],
      title: 'Innovator branch',
      subtitle: 'Architecture branch',
      payload: {
        kind: 'tool',
        toolName: 'run_subagent',
        args: {
          architectureRunId: 'run-123',
          nodeId: 'innovator',
          objective: 'Innovator branch for hydration audit proof',
        },
        activity: null,
        result: null,
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

    expect(screen.queryByText('Objective')).toBeNull();
    expect(screen.queryByText(/Innovator branch for hydration/)).toBeNull();
  });

  it('keeps tool argument metadata available in detailed card density', () => {
    const model = makeModel();

    render(
      <ExecutionGraphBoard
        cardDensity="detailed"
        model={model}
        selectedNodeId="tool-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.getByText('calculator/index.html')).toBeInTheDocument();
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
});
