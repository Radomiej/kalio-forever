import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useGraphConnectorDragController } from './useGraphConnectorDragController';

type ConnectorState = {
  sourceNodeId: string;
  direction: 'output' | 'input';
  moved: boolean;
  pointerId: number;
  startX: number;
  startY: number;
};

function pointerEvent(init: Partial<PointerEvent> & { currentTarget?: HTMLElement }) {
  const currentTarget = init.currentTarget ?? document.createElement('div');
  return {
    altKey: init.altKey ?? false,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    pointerId: init.pointerId ?? 1,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    currentTarget,
  };
}

describe('useGraphConnectorDragController', () => {
  const originalElementFromPoint = document.elementFromPoint;

  beforeEach(() => {
    document.elementFromPoint = vi.fn(() => null);
  });

  afterEach(() => {
    document.elementFromPoint = originalElementFromPoint;
  });

  it('updates preview after drag threshold', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useGraphConnectorDragController<ConnectorState>({
      createDragState: (event, meta) => ({
        ...meta,
        moved: false,
        pointerId: event.pointerId ?? 1,
        startX: event.clientX,
        startY: event.clientY,
      }),
      adapter: {
        resolveDropTarget: () => null,
        onCommit,
        applyAutoPan: vi.fn(),
        clientToPreviewPoint: (x, y) => ({ x, y }),
        getAutoPanBounds: () => null,
      },
    }));

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent({ clientX: 0, clientY: 0 }) as never, {
        sourceNodeId: 'a',
        direction: 'output',
      });
    });
    expect(result.current.draggingConnector).toBeNull();

    act(() => {
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 20, clientY: 10 }) as never);
    });
    expect(result.current.draggingConnector).toEqual({
      sourceNodeId: 'a',
      direction: 'output',
      targetNodeId: null,
      previewPoint: { x: 20, y: 10 },
    });
  });

  it('calls applyAutoPan near viewport edge', () => {
    const applyAutoPan = vi.fn();
    const bounds = { left: 0, top: 0, right: 200, bottom: 200 };
    const { result } = renderHook(() => useGraphConnectorDragController<ConnectorState>({
      createDragState: (event, meta) => ({
        ...meta,
        moved: false,
        pointerId: event.pointerId ?? 1,
        startX: event.clientX,
        startY: event.clientY,
      }),
      adapter: {
        resolveDropTarget: () => null,
        onCommit: vi.fn(),
        applyAutoPan,
        clientToPreviewPoint: (x, y) => ({ x, y }),
        getAutoPanBounds: () => bounds,
      },
    }));

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent({ clientX: 0, clientY: 0 }) as never, {
        sourceNodeId: 'a',
        direction: 'output',
      });
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 10, clientY: 100 }) as never);
    });

    expect(applyAutoPan).toHaveBeenCalledWith(10, 100);
  });

  it('does not commit when target is null', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useGraphConnectorDragController<ConnectorState>({
      createDragState: (event, meta) => ({
        ...meta,
        moved: false,
        pointerId: event.pointerId ?? 1,
        startX: event.clientX,
        startY: event.clientY,
      }),
      adapter: {
        resolveDropTarget: () => null,
        onCommit,
        applyAutoPan: vi.fn(),
        clientToPreviewPoint: (x, y) => ({ x, y }),
        getAutoPanBounds: () => null,
      },
    }));

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent({ clientX: 0, clientY: 0 }) as never, {
        sourceNodeId: 'a',
        direction: 'output',
      });
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 20, clientY: 0 }) as never);
      result.current.handlers.onPointerUp(pointerEvent({ clientX: 20, clientY: 0 }) as never);
    });

    expect(onCommit).toHaveBeenCalledWith('a', null, true);
  });

  it('commits resolved drop target on pointer up', () => {
    const onCommit = vi.fn();
    const resolveDropTarget = vi.fn(() => 'target-b');
    const { result } = renderHook(() => useGraphConnectorDragController<ConnectorState>({
      createDragState: (event, meta) => ({
        ...meta,
        moved: false,
        pointerId: event.pointerId ?? 1,
        startX: event.clientX,
        startY: event.clientY,
      }),
      adapter: {
        resolveDropTarget,
        onCommit,
        applyAutoPan: vi.fn(),
        clientToPreviewPoint: (x, y) => ({ x, y }),
        getAutoPanBounds: () => null,
      },
    }));

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent({ clientX: 0, clientY: 0 }) as never, {
        sourceNodeId: 'a',
        direction: 'output',
      });
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 20, clientY: 0 }) as never);
      result.current.handlers.onPointerUp(pointerEvent({ clientX: 20, clientY: 0 }) as never);
    });

    expect(onCommit).toHaveBeenCalledWith('a', 'target-b', true);
  });
});
