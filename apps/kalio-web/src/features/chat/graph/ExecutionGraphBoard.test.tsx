import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import type { ExecutionGraphModel } from './executionGraphModel';
import { ExecutionGraphBoard } from './ExecutionGraphBoard';

const noop = vi.fn();

function fireNodePointerEvent(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  options: { altKey?: boolean; button?: number; pointerId: number; clientX: number; clientY: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'altKey', { value: options.altKey ?? false });
  Object.defineProperty(event, 'button', { value: options.button ?? 0 });
  Object.defineProperty(event, 'pointerId', { value: options.pointerId });
  Object.defineProperty(event, 'clientX', { value: options.clientX });
  Object.defineProperty(event, 'clientY', { value: options.clientY });
  fireEvent(element, event);
}

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
    expect(screen.getByTestId('graph-node-status-turn:turn-1')).toHaveAttribute('aria-label', 'Status: running');
    expect(screen.getByTestId('graph-node-status-final:turn-1')).toHaveAttribute('aria-label', 'Status: ready');
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
    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 640,
      bottom: 360,
      width: 640,
      height: 360,
      toJSON: () => ({}),
    });

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
    expect(screen.getByTestId('execution-graph-overview')).toBeInTheDocument();
    getBoundingClientRect.mockRestore();
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

  it('keeps panning recoverable when the user drags far past the graph bounds', () => {
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
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 }),
    });

    fireEvent.mouseDown(viewport, { button: 0, clientX: 200, clientY: 160 });
    fireEvent.mouseMove(viewport, { clientX: 2200, clientY: -1800 });

    expect(stage.style.transform).toContain('translate(542px, -172px)');
  });

  it('resets the graph pan when the viewport reset token changes', () => {
    const { rerender } = render(
      <ExecutionGraphBoard
        model={makeModel()}
        resetViewportToken={0}
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

    rerender(
      <ExecutionGraphBoard
        model={makeModel()}
        resetViewportToken={1}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    expect(stage.style.transform).toContain('translate(0px, 0px)');
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
    act(() => {
      viewport.dispatchEvent(wheelEvent);
    });

    expect(onWheelZoom).toHaveBeenCalledWith(-120);
    expect(wheelEvent.defaultPrevented).toBe(true);
  });

  it('keeps the cursor focal point stable while wheel zooming the graph', async () => {
    const onWheelZoom = vi.fn().mockReturnValue(1.15);
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
    const stage = screen.getByTestId('execution-graph-stage');
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650 }),
    });

    const wheelEvent = new WheelEvent('wheel', {
      cancelable: true,
      clientX: 300,
      clientY: 200,
      deltaY: -120,
    });
    await act(async () => {
      viewport.dispatchEvent(wheelEvent);
      await Promise.resolve();
    });

    expect(onWheelZoom).toHaveBeenCalledWith(-120);
    expect(stage.style.transform).toContain('translate(-30px, -22px)');
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
    expect(screen.getByTestId('graph-node-turn-1')).toHaveClass('overflow-visible');
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

  it('drags a node without panning the map and updates connected edges', () => {
    const onSelectNode = vi.fn();
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={onSelectNode}
        zoom={1}
      />,
    );

    const node = screen.getByTestId('graph-node-turn-1');
    const dragHandle = screen.getByTestId('graph-node-drag-handle-turn-1');
    const edge = screen.getByTestId('graph-edge-turn-1->tool-1:solid');
    const initialPath = edge.getAttribute('d');
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const hasPointerCapture = vi.fn().mockReturnValue(true);
    Object.assign(dragHandle, { setPointerCapture, releasePointerCapture, hasPointerCapture });

    expect(dragHandle).toHaveClass('min-h-7');
    expect(dragHandle).toHaveAttribute('aria-label', 'Drag RaBuilder');

    fireNodePointerEvent(dragHandle, 'pointerdown', { button: 0, pointerId: 7, clientX: 30, clientY: 40 });
    fireNodePointerEvent(dragHandle, 'pointermove', { pointerId: 7, clientX: 70, clientY: 65 });
    fireNodePointerEvent(dragHandle, 'pointerup', { pointerId: 7, clientX: 70, clientY: 65 });

    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(node).toHaveStyle({ left: '60px', top: '55px' });
    expect(screen.getByTestId('graph-edge-turn-1->tool-1:solid').getAttribute('d')).not.toBe(initialPath);
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it('drags a node from the card body so moving cards is not hidden behind a tiny handle', () => {
    const onSelectNode = vi.fn();
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={onSelectNode}
        zoom={1}
      />,
    );

    const node = screen.getByTestId('graph-node-turn-1');
    const edge = screen.getByTestId('graph-edge-turn-1->tool-1:solid');
    const initialPath = edge.getAttribute('d');
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const hasPointerCapture = vi.fn().mockReturnValue(true);
    Object.assign(node, { setPointerCapture, releasePointerCapture, hasPointerCapture });

    expect(node).toHaveClass('cursor-grab');

    fireNodePointerEvent(node, 'pointerdown', { button: 0, pointerId: 17, clientX: 40, clientY: 50 });
    fireNodePointerEvent(node, 'pointermove', { pointerId: 17, clientX: 96, clientY: 92 });
    fireNodePointerEvent(node, 'pointerup', { pointerId: 17, clientX: 96, clientY: 92 });
    fireEvent.click(node);

    expect(setPointerCapture).toHaveBeenCalledWith(17);
    expect(releasePointerCapture).toHaveBeenCalledWith(17);
    expect(node).toHaveStyle({ left: '76px', top: '72px' });
    expect(screen.getByTestId('graph-edge-turn-1->tool-1:solid').getAttribute('d')).not.toBe(initialPath);
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it('selects a node from the card body without dragging it', () => {
    const onSelectNode = vi.fn();
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={onSelectNode}
        zoom={1}
      />,
    );

    const node = screen.getByTestId('graph-node-turn-1');
    const stage = screen.getByTestId('execution-graph-stage');
    Object.assign(node, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });

    fireNodePointerEvent(node, 'pointerdown', { button: 0, pointerId: 13, clientX: 40, clientY: 50 });
    fireNodePointerEvent(node, 'pointermove', { pointerId: 13, clientX: 42, clientY: 51 });
    fireNodePointerEvent(node, 'pointerup', { pointerId: 13, clientX: 42, clientY: 51 });
    fireEvent.click(node);

    expect(node).toHaveStyle({ left: '20px', top: '30px' });
    expect(stage.style.transform).toBe('translate(0px, 0px)');
    expect(onSelectNode).toHaveBeenCalledWith('turn-1');
  });

  it('pans the map from over a node while the space key is held', () => {
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    const viewport = screen.getByTestId('execution-graph-viewport');
    const node = screen.getByTestId('graph-node-turn-1');
    const stage = screen.getByTestId('execution-graph-stage');
    Object.assign(viewport, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });

    fireEvent.keyDown(window, { key: ' ' });
    expect(viewport).toHaveAttribute('data-space-panning', 'true');

    fireNodePointerEvent(node, 'pointerdown', { button: 0, pointerId: 11, clientX: 80, clientY: 90 });
    fireNodePointerEvent(viewport, 'pointermove', { pointerId: 11, clientX: 130, clientY: 124 });

    expect(node).toHaveStyle({ left: '20px', top: '30px' });
    expect(stage.style.transform).toContain('translate(50px, 34px)');

    fireEvent.keyUp(window, { key: ' ' });
    expect(viewport).toHaveAttribute('data-space-panning', 'false');
  });

  it('pans the map with middle-button drag even when starting over a node', () => {
    const onSelectNode = vi.fn();
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={onSelectNode}
        zoom={1}
      />,
    );

    const viewport = screen.getByTestId('execution-graph-viewport');
    const node = screen.getByTestId('graph-node-turn-1');
    const stage = screen.getByTestId('execution-graph-stage');
    Object.assign(viewport, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });

    fireNodePointerEvent(node, 'pointerdown', { button: 1, pointerId: 21, clientX: 80, clientY: 90 });
    fireNodePointerEvent(viewport, 'pointermove', { pointerId: 21, clientX: 132, clientY: 128 });

    expect(node).toHaveStyle({ left: '20px', top: '30px' });
    expect(stage.style.transform).toContain('translate(52px, 38px)');
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it('pans the map with alt-drag even when starting over a node', () => {
    const onSelectNode = vi.fn();
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={onSelectNode}
        zoom={1}
      />,
    );

    const viewport = screen.getByTestId('execution-graph-viewport');
    const node = screen.getByTestId('graph-node-turn-1');
    const stage = screen.getByTestId('execution-graph-stage');
    Object.assign(viewport, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });

    fireNodePointerEvent(node, 'pointerdown', { altKey: true, button: 0, pointerId: 22, clientX: 80, clientY: 90 });
    fireNodePointerEvent(viewport, 'pointermove', { altKey: true, pointerId: 22, clientX: 126, clientY: 122 });

    expect(node).toHaveStyle({ left: '20px', top: '30px' });
    expect(stage.style.transform).toContain('translate(46px, 32px)');
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it('does not enter space-panning mode from connector buttons', () => {
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    const viewport = screen.getByTestId('execution-graph-viewport');
    const outputPin = screen.getByTestId('graph-node-output-pin-turn-1');

    fireEvent.keyDown(outputPin, { key: ' ' });

    expect(viewport).toHaveAttribute('data-space-panning', 'false');
  });

  it('uses large connector hit targets without starting node drag or map pan', () => {
    const onSelectNode = vi.fn();
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={onSelectNode}
        zoom={1}
      />,
    );

    const node = screen.getByTestId('graph-node-turn-1');
    const outputPin = screen.getByTestId('graph-node-output-pin-turn-1');
    const stage = screen.getByTestId('execution-graph-stage');

    expect(outputPin).toHaveClass('h-14', 'w-14', 'cursor-crosshair', 'bg-transparent');

    fireNodePointerEvent(outputPin, 'pointerdown', { button: 0, pointerId: 8, clientX: 140, clientY: 70 });
    fireNodePointerEvent(outputPin, 'pointermove', { pointerId: 8, clientX: 143, clientY: 73 });
    fireEvent.click(outputPin);

    expect(node).toHaveStyle({ left: '20px', top: '30px' });
    expect(stage.style.transform).toBe('translate(0px, 0px)');
    expect(onSelectNode).toHaveBeenCalledWith('turn-1');
    expect(screen.queryByTestId('graph-connector-preview')).toBeNull();
    expect(screen.queryByTestId('graph-connector-drag-hint')).toBeNull();
  });

  it('compensates connector hitbox size at low zoom so touch targets stay reachable', () => {
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={0.5}
      />,
    );

    expect(screen.getByTestId('graph-node-output-pin-turn-1')).toHaveStyle({ height: '120px', width: '120px' });
  });

  it('keeps connector hitboxes touch-safe at high zoom while the visible dot stays small', () => {
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={1.6}
      />,
    );

    const outputPin = screen.getByTestId('graph-node-output-pin-turn-1');

    expect(outputPin).toHaveStyle({ height: '48px', width: '48px' });
    expect(outputPin.firstElementChild).toHaveClass('h-2', 'w-2');
  });

  it('previews a read-only connector route while dragging from a connector pin', () => {
    const onSelectNode = vi.fn();
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={onSelectNode}
        zoom={1}
      />,
    );

    const viewport = screen.getByTestId('execution-graph-viewport');
    const node = screen.getByTestId('graph-node-turn-1');
    const outputPin = screen.getByTestId('graph-node-output-pin-turn-1');
    const stage = screen.getByTestId('execution-graph-stage');
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 10, top: 20, width: 800, height: 600, right: 810, bottom: 620 }),
    });
    Object.assign(outputPin, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });

    fireNodePointerEvent(outputPin, 'pointerdown', { button: 0, pointerId: 18, clientX: 140, clientY: 70 });
    fireNodePointerEvent(outputPin, 'pointermove', { pointerId: 18, clientX: 260, clientY: 160 });

    expect(screen.getByTestId('graph-connector-preview')).toBeInTheDocument();
    expect(screen.getByTestId('graph-connector-drag-hint')).toHaveTextContent('Drag to a target input pin');
    expect(node).toHaveStyle({ left: '20px', top: '30px' });
    expect(stage.style.transform).toBe('translate(0px, 0px)');
    expect(onSelectNode).toHaveBeenCalledWith('turn-1');

    fireNodePointerEvent(outputPin, 'pointerup', { pointerId: 18, clientX: 260, clientY: 160 });

    expect(screen.queryByTestId('graph-connector-preview')).toBeNull();
    expect(screen.queryByTestId('graph-connector-drag-hint')).toBeNull();
  });

  it('auto-pans the map while dragging a connector near the viewport edge', () => {
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    const viewport = screen.getByTestId('execution-graph-viewport');
    const outputPin = screen.getByTestId('graph-node-output-pin-turn-1');
    const stage = screen.getByTestId('execution-graph-stage');
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 10, top: 20, width: 800, height: 600, right: 810, bottom: 620 }),
    });
    Object.assign(outputPin, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });

    fireNodePointerEvent(outputPin, 'pointerdown', { button: 0, pointerId: 23, clientX: 140, clientY: 70 });
    fireNodePointerEvent(outputPin, 'pointermove', { pointerId: 23, clientX: 790, clientY: 300 });

    expect(screen.getByTestId('graph-connector-preview')).toBeInTheDocument();
    expect(stage.style.transform).toContain('translate(-28px, 0px)');
  });

  it('highlights a compatible connector target and selects it on release', () => {
    const onSelectNode = vi.fn();
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={onSelectNode}
        zoom={1}
      />,
    );

    const viewport = screen.getByTestId('execution-graph-viewport');
    const outputPin = screen.getByTestId('graph-node-output-pin-turn-1');
    const targetPin = screen.getByTestId('graph-node-input-pin-tool-1');
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 10, top: 20, width: 800, height: 600, right: 810, bottom: 620 }),
    });
    Object.assign(outputPin, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });
    const previousElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue(targetPin),
    });

    fireNodePointerEvent(outputPin, 'pointerdown', { button: 0, pointerId: 19, clientX: 140, clientY: 70 });
    fireNodePointerEvent(outputPin, 'pointermove', { pointerId: 19, clientX: 220, clientY: 210 });

    expect(screen.getByTestId('graph-connector-drag-hint')).toHaveTextContent('Release on target pin to inspect route');
    expect(screen.getByTestId('graph-node-tool-1')).toHaveAttribute('data-graph-connector-drop-target', 'input');
    expect(targetPin).toHaveClass('ring-2');

    fireNodePointerEvent(outputPin, 'pointerup', { pointerId: 19, clientX: 220, clientY: 210 });

    expect(onSelectNode).toHaveBeenLastCalledWith('tool-1');
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: previousElementFromPoint,
    });
  });

  it('keeps graph card selection separate from keyboard-accessible connector pins', () => {
    const onSelectNode = vi.fn();
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={onSelectNode}
        zoom={1}
      />,
    );

    const node = screen.getByTestId('graph-node-turn-1');
    const inputPin = screen.getByTestId('graph-node-input-pin-turn-1');
    const outputPin = screen.getByTestId('graph-node-output-pin-turn-1');

    expect(node).not.toHaveAttribute('role');
    expect(node).not.toHaveAttribute('tabindex');
    expect(node).toHaveAttribute('aria-label', 'Turn: RaBuilder');
    expect(inputPin).toHaveAttribute('aria-label', 'Select RaBuilder input connector');
    expect(outputPin).toHaveAttribute('aria-label', 'Select RaBuilder output connector');

    fireEvent.click(node);
    fireEvent.click(outputPin);

    expect(onSelectNode).toHaveBeenCalledTimes(2);
    expect(onSelectNode).toHaveBeenNthCalledWith(1, 'turn-1');
    expect(onSelectNode).toHaveBeenNthCalledWith(2, 'turn-1');
  });

  it('selects a connection target from the edge hitbox without panning the map', () => {
    const onSelectNode = vi.fn();
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={onSelectNode}
        zoom={1}
      />,
    );

    const viewport = screen.getByTestId('execution-graph-viewport');
    const stage = screen.getByTestId('execution-graph-stage');
    const edgeHitbox = screen.getByTestId('graph-edge-hitbox-turn-1->tool-1:solid');

    fireEvent.pointerDown(edgeHitbox, { button: 0, pointerId: 10, clientX: 150, clientY: 120 });
    fireEvent.click(edgeHitbox);
    fireEvent.pointerMove(viewport, { pointerId: 10, clientX: 240, clientY: 210 });

    expect(onSelectNode).toHaveBeenCalledWith('tool-1');
    expect(stage.style.transform).toBe('translate(0px, 0px)');
  });

  it('selects a connection target from the keyboard edge hitbox', () => {
    const onSelectNode = vi.fn();
    render(
      <ExecutionGraphBoard
        model={makeModel()}
        selectedNodeId="turn-1"
        onSelectNode={onSelectNode}
        zoom={1}
      />,
    );

    fireEvent.keyDown(screen.getByTestId('graph-edge-hitbox-turn-1->tool-1:solid'), { key: 'Enter' });

    expect(onSelectNode).toHaveBeenCalledWith('tool-1');
  });

  it('highlights selected-node relationships and de-emphasizes unrelated graph branches', () => {
    const model = makeModel();
    model.nodes.push({
      id: 'final-1',
      kind: 'final-answer',
      title: 'Final response',
      subtitle: 'Done',
      status: 'success',
      column: 2,
      row: 0,
      x: 420,
      y: 30,
      width: 120,
      height: 80,
      payload: {
        kind: 'final-answer',
        message: null,
        turn: {} as never,
      },
    });
    model.edges.push({
      id: 'tool-1->final-1:solid',
      sourceId: 'tool-1',
      targetId: 'final-1',
      style: 'solid',
    });

    render(
      <ExecutionGraphBoard
        model={model}
        selectedNodeId="final-1"
        onSelectNode={noop}
        zoom={1}
      />,
    );

    expect(screen.getByTestId('graph-edge-tool-1->final-1:solid')).toHaveAttribute('data-related', 'true');
    expect(screen.getByTestId('graph-edge-turn-1->tool-1:solid')).toHaveAttribute('data-related', 'false');
    expect(screen.getByTestId('graph-edge-turn-1->tool-1:solid').parentElement).toHaveClass('opacity-48');
    expect(screen.getByTestId('graph-node-turn-1')).toHaveClass('opacity-70');
    expect(screen.getByTestId('graph-node-turn-1')).toHaveClass('saturate-75');
    expect(screen.getByTestId('graph-node-tool-1')).not.toHaveClass('opacity-70');
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

  it('shows a compact preview signal inside preview-capable tool nodes', () => {
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
    expect(screen.getByText('Calculator preview')).toBeInTheDocument();
  });
});
