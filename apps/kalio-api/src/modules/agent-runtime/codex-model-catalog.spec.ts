import { describe, expect, it, vi } from 'vitest';
import { readCodexModels } from './codex-model-catalog';

describe('readCodexModels', () => {
  it('uses the host catalog, follows pages and excludes hidden entries', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ data: [{ model: 'current', hidden: false }, { model: 'hidden', hidden: true }], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ data: [{ model: 'current' }, { model: 'other' }], nextCursor: null });
    await expect(readCodexModels({ request })).resolves.toEqual(['current', 'other']);
    expect(request).toHaveBeenNthCalledWith(1, 'model/list', { limit: 100, includeHidden: false });
    expect(request).toHaveBeenNthCalledWith(2, 'model/list', { limit: 100, includeHidden: false, cursor: 'page-2' });
  });

  it('preserves an authoritative empty catalog without configured fallback', async () => {
    await expect(readCodexModels({ request: vi.fn().mockResolvedValue({ data: [], nextCursor: null }) })).resolves.toEqual([]);
  });

  it.each([null, {}, { data: 'models' }, { data: [{ model: 7 }] }, { data: [], nextCursor: 9 }])('rejects malformed responses %j', async (response) => {
    await expect(readCodexModels({ request: vi.fn().mockResolvedValue(response) })).rejects.toThrow('Codex model catalog');
  });

  it('rejects repeated pagination cursors instead of looping', async () => {
    const request = vi.fn().mockResolvedValue({ data: [], nextCursor: 'same' });
    await expect(readCodexModels({ request })).rejects.toThrow('repeated cursor');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('propagates provider errors rather than advertising configured models', async () => {
    await expect(readCodexModels({ request: vi.fn().mockRejectedValue(new Error('offline')) })).rejects.toThrow('offline');
  });

  it('bounds an unresponsive host request', async () => {
    vi.useFakeTimers();
    try {
      const read = readCodexModels({ request: vi.fn(() => new Promise<unknown>(() => undefined)) });
      const rejected = expect(read).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(15_000);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
