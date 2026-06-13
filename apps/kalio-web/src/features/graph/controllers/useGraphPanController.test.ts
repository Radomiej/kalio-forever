import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useGraphPanController } from './useGraphPanController';

function createPointerEvent(
  type: string,
  init: Partial<PointerEvent> & { currentTarget?: HTMLElement; target?: EventTarget },
) {
  const target = init.target ?? document.createElement('div');
  const currentTarget = init.currentTarget ?? (target as HTMLElement);
  return {
    altKey: init.altKey ?? false,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    pointerId: init.pointerId ?? 1,
    preventDefault: vi.fn(),
    target,
    currentTarget,
    type,
  };
}

describe('useGraphPanController', () => {
  it('blocks panning from interactive controls', () => {
    const setPan = vi.fn();
    const control = document.createElement('button');
    control.setAttribute('data-graph-control', 'true');
    const { result } = renderHook(() => useGraphPanController({
      pan: { x: 0, y: 0 },
      setPan,
      spacePanning: false,
      blockedSelector: '[data-graph-control="true"]',
      useMouseFallback: false,
    }));

    act(() => {
      result.current.handlers.onPointerDown(createPointerEvent('pointerdown', { target: control }) as never);
    });

    expect(setPan).not.toHaveBeenCalled();
    expect(result.current.dragging).toBe(false);
  });

  it('allows force-pan over blocked controls with alt key', () => {
    const setPan = vi.fn();
    const control = document.createElement('button');
    control.setAttribute('data-graph-control', 'true');
    const { result } = renderHook(() => useGraphPanController({
      pan: { x: 10, y: 20 },
      setPan,
      spacePanning: false,
      blockedSelector: '[data-graph-control="true"]',
      useMouseFallback: false,
    }));

    act(() => {
      result.current.handlers.onPointerDown(createPointerEvent('pointerdown', {
        altKey: true,
        clientX: 100,
        clientY: 80,
        target: control,
      }) as never);
    });

    expect(result.current.dragging).toBe(true);
  });

  it('applies clampPan when provided', () => {
    const setPan = vi.fn();
    const { result } = renderHook(() => useGraphPanController({
      pan: { x: 0, y: 0 },
      setPan,
      spacePanning: false,
      blockedSelector: '',
      clampPan: (next) => ({ x: Math.min(next.x, 50), y: next.y }),
      useMouseFallback: false,
    }));

    act(() => {
      result.current.handlers.onPointerDown(createPointerEvent('pointerdown', {
        clientX: 0,
        clientY: 0,
      }) as never);
      result.current.handlers.onPointerMove(createPointerEvent('pointermove', {
        clientX: 100,
        clientY: 0,
      }) as never);
    });

    expect(setPan).toHaveBeenCalledWith({ x: 50, y: 0 });
  });

  it('supports mouse fallback when enabled', () => {
    const setPan = vi.fn();
    const { result } = renderHook(() => useGraphPanController({
      pan: { x: 0, y: 0 },
      setPan,
      spacePanning: false,
      blockedSelector: '',
      useMouseFallback: true,
    }));

    act(() => {
      result.current.handlers.onMouseDown?.({
        altKey: false,
        button: 0,
        clientX: 0,
        clientY: 0,
        preventDefault: vi.fn(),
        target: document.createElement('div'),
        currentTarget: document.createElement('div'),
      } as never);
      result.current.handlers.onMouseMove?.({
        clientX: 40,
        clientY: 30,
      } as never);
    });

    expect(setPan).toHaveBeenCalledWith({ x: 40, y: 30 });
  });

  it('resetPan clears active drag mid-pointer', () => {
    const setPan = vi.fn();
    const { result } = renderHook(() => useGraphPanController({
      pan: { x: 0, y: 0 },
      setPan,
      spacePanning: false,
      blockedSelector: '',
      useMouseFallback: true,
    }));

    act(() => {
      result.current.handlers.onMouseDown?.({
        altKey: false,
        button: 0,
        clientX: 0,
        clientY: 0,
        preventDefault: vi.fn(),
        target: document.createElement('div'),
        currentTarget: document.createElement('div'),
      } as never);
    });
    expect(result.current.dragging).toBe(true);

    act(() => {
      result.current.resetPan();
    });
    expect(result.current.dragging).toBe(false);

    act(() => {
      result.current.handlers.onMouseMove?.({ clientX: 100, clientY: 100 } as never);
    });
    expect(setPan).not.toHaveBeenCalled();
  });
});
