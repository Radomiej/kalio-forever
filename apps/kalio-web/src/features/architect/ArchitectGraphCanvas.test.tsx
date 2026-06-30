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
    expect(edge.getAttribute('d')).toMatch(/^M 309\.6 178 C /);
    expect(edge.getAttribute('d')).toContain(', 346\.4 221');
    expect(edge.getAttribute('d')).toContain(' C ');
    expect(edge).toHaveAttribute('marker-end');
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

    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    });

    fireEvent.wheel(canvas, { clientX: 200, clientY: 100, deltaY: -100 });
    expect(screen.getByTestId('architect-zoom-label')).toHaveTextContent('92%');
    expect(transform).toHaveStyle({ transform: 'translate(-24px, -12px) scale(0.92)' });

    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(screen.getByTestId('architect-zoom-label')).toHaveTextContent('103%');
    expect(transform).toHaveStyle({ transform: 'translate(-87px, -61px) scale(1.03)' });

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
    const wheelEvent = new WheelEvent('wheel', { cancelable: true, deltaY: -120 });
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

    openGraphControls();
    fireEvent.click(screen.getByLabelText('Reset viewport'));
    expect(transform).toHaveStyle({ transform: 'translate(0px, 0px) scale(0.82)' });
  });

  it('resets an active canvas pan even before the pointer is released', () => {
    renderCanvas();
    const canvas = screen.getByTestId('architect-graph-canvas');
    const transform = screen.getByTestId('architect-canvas-transform');

    fireEvent(canvas, new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 120,
      clientY: 140,
    }));
    fireEvent(canvas, new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 180,
      clientY: 185,
    }));

    expect(transform).toHaveStyle({ transform: 'translate(60px, 45px) scale(0.82)' });

    openGraphControls();
    fireEvent.click(screen.getByLabelText('Reset viewport'));

    expect(transform).toHaveStyle({ transform: 'translate(0px, 0px) scale(0.82)' });
  });

  it('does not start canvas pan from graph toolbar controls', () => {
    renderCanvas();
    const transform = screen.getByTestId('architect-canvas-transform');
    openGraphControls();
    const resetButton = screen.getByLabelText('Reset viewport');

    fireEvent(resetButton, new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 120,
      clientY: 140,
    }));
    fireEvent(screen.getByTestId('architect-graph-canvas'), new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 180,
      clientY: 185,
    }));

    expect(transform).toHaveStyle({ transform: 'translate(0px, 0px) scale(0.82)' });
  });

  it('pans the canvas with alt drag even when starting over a node', () => {
    const onSelectNode = vi.fn();
    renderCanvas(baseSchema, onSelectNode);
    const transform = screen.getByTestId('architect-canvas-transform');
    const canvas = screen.getByTestId('architect-graph-canvas');
    Object.assign(canvas, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });

    fireArchitectPointerEvent(screen.getByTestId('architect-node-card-start'), 'pointerdown', { altKey: true, button: 0, pointerId: 26, clientX: 10, clientY: 12 });
    fireArchitectPointerEvent(canvas, 'pointermove', { altKey: true, pointerId: 26, clientX: 42, clientY: 52 });

    expect(transform).toHaveStyle({ transform: 'translate(32px, 40px) scale(0.82)' });
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it('pans the canvas with alt drag even when starting over a connector pin', () => {
    const onToggleEdge = vi.fn();
    renderCanvas(baseSchema, vi.fn(), vi.fn(), vi.fn(), vi.fn(), onToggleEdge);
    const canvas = screen.getByTestId('architect-graph-canvas');
    const transform = screen.getByTestId('architect-canvas-transform');
    Object.assign(canvas, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });

    fireArchitectPointerEvent(screen.getByTestId('architect-node-output-pin-start'), 'pointerdown', { altKey: true, button: 0, pointerId: 28, clientX: 240, clientY: 178 });
    fireArchitectPointerEvent(canvas, 'pointermove', { altKey: true, pointerId: 28, clientX: 286, clientY: 206 });

    expect(transform).toHaveStyle({ transform: 'translate(46px, 28px) scale(0.82)' });
    expect(onToggleEdge).not.toHaveBeenCalled();
  });

  it('adds a node at the clicked canvas position in add mode', () => {
    const onAddNode = vi.fn();
    renderCanvas(baseSchema, vi.fn(), vi.fn(), vi.fn(), onAddNode);

    openGraphControls();
    fireEvent.click(screen.getByTestId('architect-mode-add-node'));
    fireEvent.click(screen.getByTestId('architect-graph-canvas'), { clientX: 240, clientY: 180 });

    expect(onAddNode).toHaveBeenCalledWith({ x: 292.6829268292683, y: 219.51219512195124 }, 'role');
  });

  it('adds router nodes from the node palette', () => {
    const onAddNode = vi.fn();
    renderCanvas(baseSchema, vi.fn(), vi.fn(), vi.fn(), onAddNode);

    openGraphControls();
    fireEvent.click(screen.getByTestId('architect-mode-add-router'));
    fireEvent.click(screen.getByTestId('architect-graph-canvas'), { clientX: 260, clientY: 210 });

    expect(onAddNode).toHaveBeenCalledWith({ x: 317.07317073170736, y: 256.0975609756098 }, 'router');
  });

  it('continues node drag when schema nodes reference changes without schema id change', () => {
    const onMoveNode = vi.fn();
    const initialSchema: ArchitectSchema = {
      ...baseSchema,
      nodes: baseSchema.nodes.map((node) => ({ ...node })),
    };
    const { rerender } = render(
      <ArchitectGraphCanvas
        schema={initialSchema}
        selectedNodeId={null}
        selectedSlotId={null}
        onSelectNode={vi.fn()}
        onSelectSlot={vi.fn()}
        onMoveNode={onMoveNode}
        onAddNode={vi.fn()}
        onToggleEdge={vi.fn()}
        onAutoLayout={vi.fn()}
      />,
    );

    const dragHandle = screen.getByTestId('architect-node-drag-start');
    fireEvent(dragHandle, new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 100,
      clientY: 100,
    }));

    rerender(
      <ArchitectGraphCanvas
        schema={{
          ...initialSchema,
          nodes: initialSchema.nodes.map((node) => (
            node.id === 'start' ? { ...node, x: 125, y: 125 } : { ...node }
          )),
        }}
        selectedNodeId={null}
        selectedSlotId={null}
        onSelectNode={vi.fn()}
        onSelectSlot={vi.fn()}
        onMoveNode={onMoveNode}
        onAddNode={vi.fn()}
        onToggleEdge={vi.fn()}
        onAutoLayout={vi.fn()}
      />,
    );

    fireEvent(dragHandle, new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 150,
      clientY: 140,
    }));
    fireEvent(dragHandle, new MouseEvent('pointerup', { bubbles: true }));

    expect(onMoveNode).toHaveBeenCalledWith('start', { x: 180.97560975609755, y: 168.78048780487805 });
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

  it('does not move a node for tiny pointer drift on the drag handle', () => {
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
      clientX: 103,
      clientY: 103,
    }));
    fireEvent(dragHandle, new MouseEvent('pointerup', { bubbles: true }));

    expect(onSelectNode).toHaveBeenCalledWith('start');
    expect(onMoveNode).not.toHaveBeenCalled();
  });

  it('selects a node from the card body without dragging it', () => {
    const onSelectNode = vi.fn();
    const onMoveNode = vi.fn();
    renderCanvas(baseSchema, onSelectNode, vi.fn(), onMoveNode);

    const nodeCard = screen.getByTestId('architect-node-card-start');
    fireArchitectPointerEvent(nodeCard, 'pointerdown', { button: 0, pointerId: 16, clientX: 140, clientY: 145 });
    fireArchitectPointerEvent(nodeCard, 'pointermove', { pointerId: 16, clientX: 210, clientY: 190 });
    fireArchitectPointerEvent(nodeCard, 'pointerup', { pointerId: 16, clientX: 210, clientY: 190 });
    fireEvent.click(nodeCard);

    expect(onMoveNode).not.toHaveBeenCalled();
    expect(onSelectNode).toHaveBeenCalledWith('start');
    expect(screen.getByTestId('architect-canvas-transform')).toHaveStyle({ transform: 'translate(0px, 0px) scale(0.82)' });
  });

  it('pans the canvas from over a node while the space key is held', () => {
    const onSelectNode = vi.fn();
    const onMoveNode = vi.fn();
    renderCanvas(baseSchema, onSelectNode, vi.fn(), onMoveNode);

    const canvas = screen.getByTestId('architect-graph-canvas');
    const nodeCard = screen.getByTestId('architect-node-card-start');
    const transform = screen.getByTestId('architect-canvas-transform');
    Object.assign(canvas, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });

    fireEvent.keyDown(window, { key: ' ' });
    expect(canvas).toHaveAttribute('data-space-panning', 'true');

    fireArchitectPointerEvent(nodeCard, 'pointerdown', { button: 0, pointerId: 14, clientX: 120, clientY: 140 });
    fireArchitectPointerEvent(canvas, 'pointermove', { pointerId: 14, clientX: 180, clientY: 174 });

    expect(transform).toHaveStyle({ transform: 'translate(60px, 34px) scale(0.82)' });
    expect(onMoveNode).not.toHaveBeenCalled();
    expect(onSelectNode).not.toHaveBeenCalled();

    fireEvent.keyUp(window, { key: ' ' });
    expect(canvas).toHaveAttribute('data-space-panning', 'false');
  });

  it('pans the canvas with middle-button drag even when starting over a node', () => {
    const onSelectNode = vi.fn();
    const onMoveNode = vi.fn();
    renderCanvas(baseSchema, onSelectNode, vi.fn(), onMoveNode);

    const canvas = screen.getByTestId('architect-graph-canvas');
    const nodeCard = screen.getByTestId('architect-node-card-start');
    const transform = screen.getByTestId('architect-canvas-transform');
    Object.assign(canvas, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });

    fireArchitectPointerEvent(nodeCard, 'pointerdown', { button: 1, pointerId: 18, clientX: 120, clientY: 140 });
    fireArchitectPointerEvent(canvas, 'pointermove', { pointerId: 18, clientX: 170, clientY: 176 });

    expect(transform).toHaveStyle({ transform: 'translate(50px, 36px) scale(0.82)' });
    expect(onMoveNode).not.toHaveBeenCalled();
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it('toggles an edge by selecting two nodes in connect mode', () => {
    const onToggleEdge = vi.fn();
    renderCanvas(baseSchema, vi.fn(), vi.fn(), vi.fn(), vi.fn(), onToggleEdge);

    fireEvent.click(screen.getByTestId('architect-mode-connect'));
    fireEvent.click(screen.getByTestId('architect-node-start'));
    fireEvent.click(screen.getByTestId('architect-node-end'));

    expect(onToggleEdge).toHaveBeenCalledWith('start', 'end');
  });

  it('toggles an edge by clicking node connector pins without opening connect mode first', () => {
    const onToggleEdge = vi.fn();
    renderCanvas(baseSchema, vi.fn(), vi.fn(), vi.fn(), vi.fn(), onToggleEdge);

    fireEvent.click(screen.getByTestId('architect-node-output-pin-start'));
    fireEvent.click(screen.getByTestId('architect-router-input-pin-end'));

    expect(onToggleEdge).toHaveBeenCalledWith('start', 'end');
  });

  it('does not preview a connector for tiny pointer drift on a large connector hitbox', () => {
    const onToggleEdge = vi.fn();
    renderCanvas(baseSchema, vi.fn(), vi.fn(), vi.fn(), vi.fn(), onToggleEdge);

    const outputPin = screen.getByTestId('architect-node-output-pin-start');
    Object.assign(outputPin, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });

    fireArchitectPointerEvent(outputPin, 'pointerdown', { button: 0, pointerId: 22, clientX: 242, clientY: 178 });
    fireArchitectPointerEvent(outputPin, 'pointermove', { pointerId: 22, clientX: 245, clientY: 181 });

    expect(screen.queryByTestId('architect-connection-preview')).toBeNull();

    fireArchitectPointerEvent(outputPin, 'pointerup', { pointerId: 22, clientX: 245, clientY: 181 });

    expect(onToggleEdge).not.toHaveBeenCalled();
  });

  it('previews and completes a connector by dragging from an output pin to an input pin', () => {
    const onToggleEdge = vi.fn();
    renderCanvas(baseSchema, vi.fn(), vi.fn(), vi.fn(), vi.fn(), onToggleEdge);

    const canvas = screen.getByTestId('architect-graph-canvas');
    const outputPin = screen.getByTestId('architect-node-output-pin-start');
    const inputPin = screen.getByTestId('architect-router-input-pin-end');
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const hasPointerCapture = vi.fn().mockReturnValue(true);
    Object.assign(outputPin, { setPointerCapture, releasePointerCapture, hasPointerCapture });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    });
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue(inputPin),
    });

    fireArchitectPointerEvent(outputPin, 'pointerdown', { button: 0, pointerId: 12, clientX: 242, clientY: 178 });
    fireArchitectPointerEvent(outputPin, 'pointermove', { pointerId: 12, clientX: 360, clientY: 210 });

    expect(screen.getByTestId('architect-connection-preview')).toBeInTheDocument();
    expect(screen.getByTestId('architect-node-card-end')).toHaveAttribute('data-architect-connection-drop-target', 'true');
    expect(inputPin).toHaveClass('ring-2');

    fireArchitectPointerEvent(outputPin, 'pointerup', { pointerId: 12, clientX: 360, clientY: 210 });

    expect(setPointerCapture).toHaveBeenCalledWith(12);
    expect(releasePointerCapture).toHaveBeenCalledWith(12);
    expect(onToggleEdge).toHaveBeenCalledWith('start', 'end');
    expect(screen.queryByTestId('architect-connection-preview')).toBeNull();
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint,
    });
  });

  it('auto-pans the map while dragging a connector near the viewport edge', () => {
    renderCanvas(baseSchema, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn());

    const canvas = screen.getByTestId('architect-graph-canvas');
    const transform = screen.getByTestId('architect-canvas-transform');
    const outputPin = screen.getByTestId('architect-node-output-pin-start');
    Object.assign(outputPin, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    });

    fireArchitectPointerEvent(outputPin, 'pointerdown', { button: 0, pointerId: 24, clientX: 242, clientY: 178 });
    fireArchitectPointerEvent(outputPin, 'pointermove', { pointerId: 24, clientX: 980, clientY: 360 });

    expect(screen.getByTestId('architect-connection-preview')).toBeInTheDocument();
    expect(transform).toHaveStyle({ transform: 'translate(-28px, 0px) scale(0.82)' });
  });

  it('pans the map with a left-button drag on empty canvas space', () => {
    renderCanvas();

    const canvas = screen.getByTestId('architect-graph-canvas');
    const transform = screen.getByTestId('architect-canvas-transform');

    fireEvent(canvas, new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 300,
      clientY: 220,
    }));
    fireEvent(canvas, new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 345,
      clientY: 250,
    }));

    expect(transform).toHaveStyle({ transform: 'translate(45px, 30px) scale(0.82)' });
  });

  it('runs auto-layout on demand from the toolbar', () => {
    const onAutoLayout = vi.fn();
    renderCanvas(baseSchema, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), [], false, onAutoLayout);

    openGraphControls();
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

    openGraphControls();
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

    openGraphControls();
    fireEvent.click(screen.getByTestId('architect-auto-layout'));

    expect(onAutoLayout).not.toHaveBeenCalled();
    expect(onMoveNode).not.toHaveBeenCalled();
    expect(onAddNode).not.toHaveBeenCalled();
    expect(onToggleEdge).not.toHaveBeenCalled();
  });
});

function fireArchitectPointerEvent(
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

function openGraphControls() {
  fireEvent.click(screen.getByRole('button', { name: 'More graph controls' }));
}

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
      behavior: { mode: 'rank_then_merge', fanOut: 'sequential' },
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
