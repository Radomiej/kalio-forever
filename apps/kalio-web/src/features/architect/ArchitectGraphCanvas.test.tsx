import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectGraphCanvas } from './ArchitectGraphCanvas';
import type { ArchitectSchema } from './architect.types';
import type { ArchitectureGraphProjection } from '@kalio/types';

describe('ArchitectGraphCanvas', () => {
  it('renders curved directional edges from schema edges', () => {
    renderCanvas();

    const edge = screen.getByTestId('architect-edge-start-end');
    expect(edge.tagName.toLowerCase()).toBe('path');
    expect(edge.getAttribute('d')).toMatch(/^M 296 178 C /);
    expect(edge.getAttribute('d')).toContain(', 360 212');
    expect(edge.getAttribute('d')).toContain(' C ');
    expect(edge.getAttribute('marker-end')).toMatch(/^url\(#architect-edge-arrow-/);
    expect(screen.getByTestId('architect-node-behavior-end')).toHaveTextContent('rank then merge');
  });

  it('does not render edges with missing target nodes', () => {
    renderCanvas({
      ...baseSchema,
      edges: [{ id: 'missing-edge', fromNodeId: 'start', toNodeId: 'missing' }],
    });

    expect(screen.queryByTestId('architect-edge-missing-edge')).not.toBeInTheDocument();
  });

  it('highlights executed route hop edges', () => {
    renderCanvas(baseSchema, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), [{
      eventId: 'event-1',
      source: 'router',
      fromNodeId: 'start',
      toNodeId: 'end',
    }]);

    expect(screen.getByTestId('architect-edge-start-end')).toHaveClass('stroke-emerald-300/90');
    expect(screen.getByTestId('architect-edge-start-end')).toHaveClass('animate-pulse');
  });

  it('styles edge types as forced, routing, or parallel transitions', () => {
    renderCanvas({
      ...baseSchema,
      nodes: [
        { ...baseSchema.nodes[0], id: 'parallel', kind: 'parallel', behavior: { mode: 'fan_out_all' } },
        { ...baseSchema.nodes[0], id: 'agent', kind: 'role', behavior: undefined },
        { ...baseSchema.nodes[1], id: 'router', kind: 'router' },
        { ...baseSchema.nodes[1], id: 'done', kind: 'artifact', behavior: { mode: 'finalize' } },
      ],
      edges: [
        { id: 'parallel-agent', fromNodeId: 'parallel', toNodeId: 'agent' },
        { id: 'router-done', fromNodeId: 'router', toNodeId: 'done' },
        { id: 'agent-done', fromNodeId: 'agent', toNodeId: 'done' },
      ],
    });

    expect(screen.getByTestId('architect-edge-parallel-agent')).toHaveAttribute('data-edge-kind', 'parallel');
    expect(screen.getByTestId('architect-edge-parallel-agent')).toHaveAttribute('stroke-dasharray', '2 7');
    expect(screen.getByTestId('architect-edge-parallel-agent')).toHaveClass('stroke-violet-300/70');
    expect(screen.getByTestId('architect-edge-router-done')).toHaveAttribute('data-edge-kind', 'routing');
    expect(screen.getByTestId('architect-edge-router-done')).toHaveAttribute('stroke-dasharray', '7 5');
    expect(screen.getByTestId('architect-edge-router-done')).toHaveClass('stroke-amber-300/75');
    expect(screen.getByTestId('architect-edge-agent-done')).toHaveAttribute('data-edge-kind', 'forced');
    expect(screen.getByTestId('architect-edge-agent-done')).not.toHaveAttribute('stroke-dasharray');
  });

  it('derives edge styling from behavior mode even when node kind stays generic', () => {
    renderCanvas({
      ...baseSchema,
      nodes: [
        { ...baseSchema.nodes[0], id: 'fanout-role', kind: 'role', behavior: { mode: 'fan_out_all' } },
        { ...baseSchema.nodes[0], id: 'rank-role', kind: 'role', behavior: { mode: 'rank_then_merge', fanOut: 'sequential' } },
        { ...baseSchema.nodes[1], id: 'target-a', kind: 'artifact', behavior: undefined },
        { ...baseSchema.nodes[1], id: 'target-b', kind: 'artifact', behavior: undefined },
      ],
      edges: [
        { id: 'fanout-target-a', fromNodeId: 'fanout-role', toNodeId: 'target-a' },
        { id: 'rank-target-b', fromNodeId: 'rank-role', toNodeId: 'target-b' },
      ],
    });

    expect(screen.getByTestId('architect-edge-fanout-target-a')).toHaveAttribute('data-edge-kind', 'parallel');
    expect(screen.getByTestId('architect-edge-fanout-target-a')).toHaveAttribute('stroke-dasharray', '2 7');
    expect(screen.getByTestId('architect-edge-fanout-target-a')).toHaveClass('stroke-violet-300/70');
    expect(screen.getByTestId('architect-edge-rank-target-b')).toHaveAttribute('data-edge-kind', 'routing');
    expect(screen.getByTestId('architect-edge-rank-target-b')).toHaveAttribute('stroke-dasharray', '7 5');
    expect(screen.getByTestId('architect-edge-rank-target-b')).toHaveClass('stroke-amber-300/75');
  });

  it('keeps node and slot selection working after transform support', () => {
    const onSelectNode = vi.fn();
    const onSelectSlot = vi.fn();
    renderCanvas(baseSchema, onSelectNode, onSelectSlot);

    fireEvent.click(screen.getByTestId('architect-node-start'));
    fireEvent.click(screen.getByTestId('architect-slot-start-slot'));

    expect(onSelectNode).toHaveBeenCalledWith('start');
    expect(onSelectSlot).toHaveBeenCalledWith('start', 'start-slot');
  });

  it('uses kind-specific node accents', () => {
    renderCanvas();

    expect(screen.getByTestId('architect-node-drag-start')).toHaveClass('text-sky-100');
    expect(screen.getByTestId('architect-node-drag-end')).toHaveClass('text-amber-100');
    expect(screen.getByTestId('architect-node-kind-end')).toHaveClass('text-amber-200');
  });

  it('zooms the canvas with wheel and controls within the clamp', () => {
    renderCanvas();
    const canvas = screen.getByTestId('architect-graph-canvas');
    const transform = screen.getByTestId('architect-canvas-transform');

    fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -100 });
    expect(screen.getByTestId('architect-zoom-label')).toHaveTextContent('92%');
    expect(transform).toHaveStyle({ transform: 'translate(0px, 0px) scale(0.92)' });

    for (let index = 0; index < 20; index += 1) {
      fireEvent.click(screen.getByLabelText('Zoom in'));
    }
    expect(screen.getByTestId('architect-zoom-label')).toHaveTextContent('160%');

    for (let index = 0; index < 40; index += 1) {
      fireEvent.click(screen.getByLabelText('Zoom out'));
    }
    expect(screen.getByTestId('architect-zoom-label')).toHaveTextContent('65%');
  });

  it('keeps a large free-space work surface for panning even when all nodes fit on screen', () => {
    renderCanvas();

    expect(screen.getByTestId('architect-canvas-free-space')).toHaveStyle({
      minWidth: '2800px',
      minHeight: '1800px',
    });
  });

  it('uses a non-passive native wheel listener so zoom prevents page scroll', () => {
    const addEventListenerSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    renderCanvas();

    const canvas = screen.getByTestId('architect-graph-canvas');
    const wheelEvent = new WheelEvent('wheel', { cancelable: true, ctrlKey: true, deltaY: -120 });
    canvas.dispatchEvent(wheelEvent);

    const hasNonPassiveWheelListener = addEventListenerSpy.mock.calls.some(
      ([type, , options]) => type === 'wheel' && typeof options === 'object' && options !== null && 'passive' in options && options.passive === false,
    );
    expect(hasNonPassiveWheelListener).toBe(true);
    expect(wheelEvent.defaultPrevented).toBe(true);

    addEventListenerSpy.mockRestore();
  });

  it('pans the canvas with alt drag and resets the viewport', () => {
    renderCanvas();
    const canvas = screen.getByTestId('architect-graph-canvas');
    const transform = screen.getByTestId('architect-canvas-transform');

    fireEvent.mouseDown(canvas, { altKey: true, button: 0, clientX: 10, clientY: 12 });
    fireEvent.mouseMove(canvas, { clientX: 42, clientY: 52 });
    fireEvent.mouseUp(canvas);

    expect(transform).toHaveStyle({ transform: 'translate(32px, 40px) scale(0.82)' });

    fireEvent.click(screen.getByLabelText('Reset viewport'));
    expect(transform).toHaveStyle({ transform: 'translate(0px, 0px) scale(0.82)' });
  });

  it('does not start pan from node controls', () => {
    const onSelectNode = vi.fn();
    renderCanvas(baseSchema, onSelectNode);
    const transform = screen.getByTestId('architect-canvas-transform');

    fireEvent.mouseDown(screen.getByTestId('architect-node-start'), {
      altKey: true,
      button: 0,
      clientX: 10,
      clientY: 12,
    });
    fireEvent.mouseMove(screen.getByTestId('architect-graph-canvas'), {
      clientX: 42,
      clientY: 52,
    });
    fireEvent.click(screen.getByTestId('architect-node-start'));

    expect(transform).toHaveStyle({ transform: 'translate(0px, 0px) scale(0.82)' });
    expect(onSelectNode).toHaveBeenCalledWith('start');
  });

  it('adds a node at the clicked canvas position in add mode', () => {
    const onAddNode = vi.fn();
    renderCanvas(baseSchema, vi.fn(), vi.fn(), vi.fn(), onAddNode);

    fireEvent.click(screen.getByTestId('architect-mode-add-node'));
    fireEvent.click(screen.getByTestId('architect-graph-canvas'), { clientX: 240, clientY: 180 });

    expect(onAddNode).toHaveBeenCalledWith({ x: 292.6829268292683, y: 219.51219512195124 }, 'role');
  });

  it('adds router nodes from the node palette', () => {
    const onAddNode = vi.fn();
    renderCanvas(baseSchema, vi.fn(), vi.fn(), vi.fn(), onAddNode);

    fireEvent.click(screen.getByTestId('architect-mode-add-router'));
    fireEvent.click(screen.getByTestId('architect-graph-canvas'), { clientX: 260, clientY: 210 });

    expect(onAddNode).toHaveBeenCalledWith({ x: 317.07317073170736, y: 256.0975609756098 }, 'router');
  });

  it('moves a node from the drag handle without panning the canvas', () => {
    const onSelectNode = vi.fn();
    const onMoveNode = vi.fn();
    renderCanvas(baseSchema, onSelectNode, vi.fn(), onMoveNode);

    const dragHandle = screen.getByTestId('architect-node-drag-start');
    fireEvent(dragHandle, new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 100,
      clientY: 100,
    }));
    fireEvent(dragHandle, new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 150,
      clientY: 140,
    }));
    fireEvent(dragHandle, new MouseEvent('pointerup', { bubbles: true }));

    expect(onSelectNode).toHaveBeenCalledWith('start');
    expect(onMoveNode).toHaveBeenCalledWith('start', { x: 180.97560975609755, y: 168.78048780487805 });
    expect(screen.getByTestId('architect-canvas-transform')).toHaveStyle({ transform: 'translate(0px, 0px) scale(0.82)' });
  });

  it('toggles an edge by selecting two nodes in connect mode', () => {
    const onToggleEdge = vi.fn();
    renderCanvas(baseSchema, vi.fn(), vi.fn(), vi.fn(), vi.fn(), onToggleEdge);

    fireEvent.click(screen.getByTestId('architect-mode-connect'));
    fireEvent.click(screen.getByTestId('architect-node-start'));
    fireEvent.click(screen.getByTestId('architect-node-end'));

    expect(onToggleEdge).toHaveBeenCalledWith('start', 'end');
  });

  it('runs auto-layout on demand from the toolbar', () => {
    const onAutoLayout = vi.fn();
    renderCanvas(baseSchema, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), [], false, onAutoLayout);

    fireEvent.click(screen.getByTestId('architect-auto-layout'));

    expect(onAutoLayout).toHaveBeenCalledTimes(1);
  });

  it('keeps runtime mode read-only so run-time graph interactions do not persist as draft edits', () => {
    const onSelectNode = vi.fn();
    const onMoveNode = vi.fn();
    const onAddNode = vi.fn();
    const onToggleEdge = vi.fn();
    const onAutoLayout = vi.fn();
    renderCanvas(baseSchema, onSelectNode, vi.fn(), onMoveNode, onAddNode, onToggleEdge, [], true, onAutoLayout);

    expect(screen.getByTestId('architect-runtime-mode-indicator')).toHaveTextContent('Runtime');

    fireEvent.click(screen.getByTestId('architect-mode-add-node'));
    fireEvent.click(screen.getByTestId('architect-graph-canvas'), { clientX: 640, clientY: 220 });
    fireEvent.click(screen.getByTestId('architect-mode-connect'));
    fireEvent.click(screen.getByTestId('architect-node-start'));
    fireEvent.click(screen.getByTestId('architect-node-end'));
    fireEvent(screen.getByTestId('architect-node-drag-start'), new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 100,
      clientY: 100,
    }));

    expect(onAddNode).not.toHaveBeenCalled();
    expect(onMoveNode).not.toHaveBeenCalled();
    expect(onToggleEdge).not.toHaveBeenCalled();
    expect(onAutoLayout).not.toHaveBeenCalled();
    expect(onSelectNode).toHaveBeenCalledWith('start');
  });

  it('does not run auto-layout from the toolbar in runtime mode', () => {
    const onMoveNode = vi.fn();
    const onAddNode = vi.fn();
    const onToggleEdge = vi.fn();
    const onAutoLayout = vi.fn();
    renderCanvas(baseSchema, vi.fn(), vi.fn(), onMoveNode, onAddNode, onToggleEdge, [], true, onAutoLayout);

    fireEvent.click(screen.getByTestId('architect-auto-layout'));

    expect(onAutoLayout).not.toHaveBeenCalled();
    expect(onMoveNode).not.toHaveBeenCalled();
    expect(onAddNode).not.toHaveBeenCalled();
    expect(onToggleEdge).not.toHaveBeenCalled();
  });
});

function renderCanvas(
  schema: ArchitectSchema = baseSchema,
  onSelectNode = vi.fn(),
  onSelectSlot = vi.fn(),
  onMoveNode = vi.fn(),
  onAddNode = vi.fn(),
  onToggleEdge = vi.fn(),
  routeHops: ArchitectureGraphProjection['routeHops'] = [],
  runtimeMode = false,
  onAutoLayout = vi.fn(),
) {
  return render(
    <ArchitectGraphCanvas
      schema={schema}
      selectedNodeId={null}
      selectedSlotId={null}
      onSelectNode={onSelectNode}
      onSelectSlot={onSelectSlot}
      onMoveNode={onMoveNode}
      onAddNode={onAddNode}
      onToggleEdge={onToggleEdge}
      onAutoLayout={onAutoLayout}
      routeHops={routeHops}
      runtimeMode={runtimeMode}
    />,
  );
}

const baseSchema: ArchitectSchema = {
  id: 'schema-1',
  name: 'Schema',
  description: '',
  version: '0.1.0',
  roleSlots: [],
  nodes: [
    {
      id: 'start',
      label: 'Start',
      kind: 'role',
      x: 120,
      y: 120,
      slots: [{ id: 'start-slot', label: 'Start Slot' }],
      connections: ['end'],
    },
    {
      id: 'end',
      label: 'End',
      kind: 'router',
      behavior: { mode: 'rank_then_merge', fanOut: 'sequential', convergeToNodeId: 'start' },
      x: 360,
      y: 160,
      slots: [],
      connections: [],
    },
  ],
  edges: [{ id: 'start-end', fromNodeId: 'start', toNodeId: 'end' }],
  routerPolicy: {
    mode: 'rank_then_merge',
    mustAddressCriticFindings: false,
    canReturnNeedsMoreResearch: false,
  },
  contextPolicy: {
    includeUserTask: true,
    includeProjectMemory: false,
    includeBrowserSession: false,
    includePriorDecisions: false,
  },
  memoryPolicy: {
    persistFinalArtifact: false,
    persistRouterDecision: false,
  },
  outputArtifactSchema: 'Artifact',
};
