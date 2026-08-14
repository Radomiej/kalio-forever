import { describe, expect, it, vi } from 'vitest';
import { createIdempotentBooleanSetter } from './useAwaitingFirstChunk';

describe('createIdempotentBooleanSetter', () => {
  it('forwards only state transitions to the underlying setter', () => {
    const apply = vi.fn();
    const setAwaitingFirstChunk = createIdempotentBooleanSetter(apply);

    setAwaitingFirstChunk(false);
    setAwaitingFirstChunk(true);
    setAwaitingFirstChunk(true);
    setAwaitingFirstChunk(false);
    setAwaitingFirstChunk(false);

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(1, true);
    expect(apply).toHaveBeenNthCalledWith(2, false);
  });
});
