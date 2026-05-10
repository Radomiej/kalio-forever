import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTileIcons } from './useTileIcons';

describe('useTileIcons', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks the currently generating tile and clears it after the placeholder delay', async () => {
    const { result } = renderHook(() => useTileIcons('raapp'));

    expect(result.current.icons).toEqual({});
    expect(result.current.generating).toBeNull();

    await act(async () => {
      void result.current.generateIcon('tile-1', 'Cats');
    });
    expect(result.current.generating).toBe('tile-1');

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.generating).toBeNull();
  });

  it('removing an icon leaves the store stable when no icon is present', () => {
    const { result } = renderHook(() => useTileIcons('raapp'));

    act(() => {
      result.current.removeIcon('missing');
    });

    expect(result.current.icons).toEqual({});
  });
});
