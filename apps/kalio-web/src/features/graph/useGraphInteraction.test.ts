import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { acquirePointerCaptureIfSupported, GRAPH_MOUSE_FALLBACK_POINTER_ID, graphPointerDistance, graphViewportCenter, graphViewportClassName, graphViewportPointFromClient, graphWorldDeltaFromClientDelta, graphWorldPointFromClient, hasGraphDragStarted, nextGraphPan, nextGraphPanForAutoPan, nextGraphPanForZoom, releasePointerCaptureIfHeld, shouldStartGraphPan, useGraphViewport } from './useGraphInteraction';

describe('graph interaction helpers', () => {
  it('computes pan from the original viewport and pointer delta', () => {
    expect(nextGraphPan({
      pointerId: GRAPH_MOUSE_FALLBACK_POINTER_ID,
      startX: 100,
      startY: 80,
      originX: 12,
      originY: -4,
    }, 140, 95)).toEqual({ x: 52, y: 11 });
  });

  it('uses a screen-space threshold before starting graph drags', () => {
    expect(graphPointerDistance({
      startX: 10,
      startY: 20,
      clientX: 13,
      clientY: 24,
    })).toBe(5);

    expect(hasGraphDragStarted({
      startX: 10,
      startY: 20,
      clientX: 12,
      clientY: 23,
    })).toBe(false);

    expect(hasGraphDragStarted({
      startX: 10,
      startY: 20,
      clientX: 13,
      clientY: 24,
    })).toBe(true);
  });

  it('converts client drag deltas into world-space deltas only after the threshold check', () => {
    expect(graphWorldDeltaFromClientDelta({
      startX: 30,
      startY: 40,
      clientX: 70,
      clientY: 65,
      zoom: 0.5,
    })).toEqual({ x: 80, y: 50 });
  });

  it('blocks panning from interactive graph controls unless a force-pan gesture is active', () => {
    const control = document.createElement('button');
    control.setAttribute('data-graph-node-card', 'true');

    expect(shouldStartGraphPan({
      blockedSelector: '[data-graph-node-card="true"]',
      button: 0,
      target: control,
    })).toBe(false);

    expect(shouldStartGraphPan({
      blockedSelector: '[data-graph-node-card="true"]',
      button: 0,
      forcePan: true,
      target: control,
    })).toBe(true);
  });

  it('rejects non-pan mouse buttons even when the target is empty canvas space', () => {
    expect(shouldStartGraphPan({
      button: 2,
      target: document.createElement('div'),
    })).toBe(false);
  });

  it('keeps the same world point under the focal point while zooming', () => {
    expect(nextGraphPanForZoom({
      focalPoint: { x: 200, y: 100 },
      camera: { pan: { x: 0, y: 0 }, zoom: 0.82 },
      nextZoom: 0.92,
    })).toEqual({ x: -24, y: -12 });
  });

  it('auto-pans the graph camera when connector dragging reaches viewport edges', () => {
    const bounds = {
      left: 100,
      top: 40,
      right: 900,
      bottom: 640,
    } as DOMRect;

    expect(nextGraphPanForAutoPan({
      bounds,
      clientX: 500,
      clientY: 320,
      pan: { x: 0, y: 0 },
    })).toEqual({ x: 0, y: 0 });

    expect(nextGraphPanForAutoPan({
      bounds,
      clientX: 880,
      clientY: 620,
      pan: { x: 0, y: 0 },
    })).toEqual({ x: -28, y: -28 });

    expect(nextGraphPanForAutoPan({
      bounds,
      clientX: 120,
      clientY: 60,
      pan: { x: 10, y: -10 },
    })).toEqual({ x: 38, y: 18 });
  });

  it('derives viewport focal points from client coordinates and bounds', () => {
    const bounds = {
      left: 100,
      top: 40,
      width: 800,
      height: 600,
    } as DOMRect;

    expect(graphViewportPointFromClient(bounds, 250, 190)).toEqual({ x: 150, y: 150 });
    expect(graphViewportCenter(bounds)).toEqual({ x: 400, y: 300 });
  });

  it('derives world points from client coordinates and camera state', () => {
    const bounds = {
      left: 100,
      top: 40,
      width: 800,
      height: 600,
    } as DOMRect;

    expect(graphWorldPointFromClient({
      bounds,
      camera: { pan: { x: 50, y: 20 }, zoom: 2 },
      clientX: 250,
      clientY: 180,
    })).toEqual({ x: 50, y: 60 });
  });

  it('builds a shared graph viewport class with interaction cursor state', () => {
    expect(graphViewportClassName({ dragging: false, extraClassName: 'flex-1' })).toContain('cursor-grab');
    expect(graphViewportClassName({ dragging: true })).toContain('cursor-grabbing');
    expect(graphViewportClassName({ dragging: false })).toContain('touch-none');
  });

  it('keeps viewport camera state in a reusable hook', () => {
    const { result } = renderHook(() => useGraphViewport({
      initialPan: { x: 10, y: 20 },
      initialZoom: 1,
    }));

    act(() => result.current.zoomTo(2, { x: 110, y: 120 }));

    expect(result.current.zoom).toBe(2);
    expect(result.current.pan).toEqual({ x: -90, y: -80 });
    expect(result.current.clientToWorld({
      left: 10,
      top: 20,
      width: 300,
      height: 200,
    } as DOMRect, 110, 120)).toEqual({ x: 95, y: 90 });
  });

  it('acquires and releases pointer capture when supported', () => {
    const element = document.createElement('div');
    const setPointerCapture = vi.fn();
    const hasPointerCapture = vi.fn(() => true);
    const releasePointerCapture = vi.fn();
    Object.assign(element, { setPointerCapture, hasPointerCapture, releasePointerCapture });

    acquirePointerCaptureIfSupported(element, 3);
    expect(setPointerCapture).toHaveBeenCalledWith(3);

    releasePointerCaptureIfHeld(element, 3);
    expect(releasePointerCapture).toHaveBeenCalledWith(3);
  });
});
