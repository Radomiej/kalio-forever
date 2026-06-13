import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useGraphNodeDragController } from './useGraphNodeDragController';

type TestNode = { id: string; x: number; y: number };

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

describe('useGraphNodeDragController', () => {
  it('does not commit position before drag threshold', () => {
    const commitPosition = vi.fn();
    const node: TestNode = { id: 'n1', x: 100, y: 100 };
    const { result } = renderHook(() => useGraphNodeDragController<TestNode>({
      zoom: 1,
      spacePanning: false,
      adapter: {
        getNodeOrigin: (n) => ({ x: n.x, y: n.y }),
        commitPosition,
      },
    }));

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent({ clientX: 10, clientY: 20 }) as never, node);
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 12, clientY: 22 }) as never);
    });

    expect(commitPosition).not.toHaveBeenCalled();
  });

  it('commits world-space delta at non-unity zoom', () => {
    const commitPosition = vi.fn();
    const node: TestNode = { id: 'n1', x: 0, y: 0 };
    const { result } = renderHook(() => useGraphNodeDragController<TestNode>({
      zoom: 0.5,
      spacePanning: false,
      adapter: {
        getNodeOrigin: (n) => ({ x: n.x, y: n.y }),
        commitPosition,
      },
    }));

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent({ clientX: 0, clientY: 0 }) as never, node);
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 50, clientY: 30 }) as never);
    });

    expect(commitPosition).toHaveBeenCalledWith('n1', { x: 100, y: 60 });
  });

  it('resetDrag clears drag without requiring pointer up', () => {
    const commitPosition = vi.fn();
    const node: TestNode = { id: 'n1', x: 0, y: 0 };
    const { result } = renderHook(() => useGraphNodeDragController<TestNode>({
      zoom: 1,
      spacePanning: false,
      adapter: {
        getNodeOrigin: (n) => ({ x: n.x, y: n.y }),
        commitPosition,
      },
    }));

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent({ clientX: 0, clientY: 0 }) as never, node);
    });
    expect(result.current.draggingNodeId).toBe('n1');

    act(() => {
      result.current.resetDrag();
    });
    expect(result.current.draggingNodeId).toBeNull();

    act(() => {
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 100, clientY: 100 }) as never);
    });
    expect(commitPosition).not.toHaveBeenCalled();
  });

  it('survives rerender with updated getNodeOrigin without resetDrag', () => {
    const commitPosition = vi.fn();
    const node: TestNode = { id: 'n1', x: 0, y: 0 };
    const { result, rerender } = renderHook(
      ({ originX }: { originX: number }) => useGraphNodeDragController<TestNode>({
        zoom: 1,
        spacePanning: false,
        adapter: {
          getNodeOrigin: () => ({ x: originX, y: 0 }),
          commitPosition,
        },
      }),
      { initialProps: { originX: 0 } },
    );

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent({ clientX: 0, clientY: 0 }) as never, node);
    });

    rerender({ originX: 200 });

    act(() => {
      result.current.handlers.onPointerMove(pointerEvent({ clientX: 10, clientY: 0 }) as never);
    });

    expect(result.current.draggingNodeId).toBe('n1');
    expect(commitPosition).toHaveBeenCalledWith('n1', { x: 10, y: 0 });
  });
});
