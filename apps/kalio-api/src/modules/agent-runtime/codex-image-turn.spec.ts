import { describe, it, expect, vi } from 'vitest';
import { runCodexImageTurn } from './codex-image-turn';
import type { CodexAppServerConnection, CodexServerNotification } from './codex-app-server.host';

function fakeConnection() {
  const listeners = new Set<(event: CodexServerNotification) => void>();
  const closed = new Set<() => void>();
  const emit = (method: string, params: unknown) => listeners.forEach(fn => fn({ method, params }));
  const request = vi.fn(async (method: string) => method === 'turn/start' ? { turn: { id: 'turn' } } : {});
  const connection: CodexAppServerConnection = {
    processEpoch: 'epoch', request, notify: vi.fn(), respond: vi.fn(), close: vi.fn(),
    onNotification: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    onRequest: () => vi.fn(),
    onClosed: fn => { const cb = () => fn({ reason: 'exit' }); closed.add(cb); return () => closed.delete(cb); },
  };
  return { connection, request, emit, listeners, closed };
}

describe('Codex image turn', () => {
  it('handles early completion, ignores another thread, and passes image inputs', async () => {
    const f = fakeConnection();
    f.request.mockImplementation(async method => {
      if (method === 'turn/start') {
        f.emit('item/completed', { threadId: 'other', turnId: 'turn', item: { type: 'imageGeneration', status: 'completed', result: 'wrong' } });
        f.emit('item/completed', { threadId: 'image', turnId: 'turn', item: { type: 'imageGeneration', status: 'completed', result: 'base64' } });
        f.emit('turn/completed', { threadId: 'image', turn: { id: 'turn', status: 'completed' } });
        return { turn: { id: 'turn' } };
      }
      return {};
    });
    await expect(runCodexImageTurn(f.connection, 'image', 'edit', undefined, 500, ['data:image/png;base64,ref'])).resolves.toBe('base64');
    expect(f.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ input: expect.arrayContaining([{ type: 'image', url: 'data:image/png;base64,ref' }]) }));
    expect(f.listeners.size).toBe(0);
    expect(f.closed.size).toBe(0);
    expect(f.connection.close).not.toHaveBeenCalled();
  });

  it('rejects text-only completion', async () => {
    const f = fakeConnection();
    const promise = runCodexImageTurn(f.connection, 'image', 'generate');
    await Promise.resolve();
    f.emit('turn/completed', { threadId: 'image', turn: { id: 'turn', status: 'completed' } });
    await expect(promise).rejects.toThrow('no generated image');
    expect(f.listeners.size).toBe(0);
  });

  it('keeps concurrent image turns separate on a shared connection', async () => {
    const f = fakeConnection();
    const first = runCodexImageTurn(f.connection, 'first', 'one');
    const second = runCodexImageTurn(f.connection, 'second', 'two');
    await Promise.resolve();
    for (const threadId of ['second', 'first']) {
      f.emit('item/completed', { threadId, turnId: 'turn', item: { type: 'imageGeneration', status: 'completed', result: threadId } });
      f.emit('turn/completed', { threadId, turn: { id: 'turn', status: 'completed' } });
    }
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(f.listeners.size).toBe(0);
    expect(f.connection.close).not.toHaveBeenCalled();
  });

  it('rejects disconnects and removes its listeners', async () => {
    const f = fakeConnection();
    const pending = runCodexImageTurn(f.connection, 'image', 'generate');
    await Promise.resolve();
    for (const close of f.closed) close();
    await expect(pending).rejects.toThrow('disconnected');
    expect(f.listeners.size).toBe(0);
    expect(f.closed.size).toBe(0);
  });

  it('times out and interrupts only this turn', async () => {
    const f = fakeConnection();
    await expect(runCodexImageTurn(f.connection, 'image', 'generate', undefined, 5)).rejects.toThrow('timed out');
    expect(f.request).toHaveBeenCalledWith('turn/interrupt', { threadId: 'image', turnId: 'turn' });
    expect(f.listeners.size).toBe(0);
  });

  it('cancels pending generation and cleans up', async () => {
    const f = fakeConnection(); const controller = new AbortController();
    const promise = runCodexImageTurn(f.connection, 'image', 'generate', controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow('cancelled');
    expect(f.listeners.size).toBe(0);
  });

  it('rejects failed turns even after receiving image bytes', async () => {
    const f = fakeConnection();
    const promise = runCodexImageTurn(f.connection, 'image', 'generate');
    await Promise.resolve();
    f.emit('item/completed', { threadId: 'image', turnId: 'turn', item: { type: 'imageGeneration', status: 'completed', result: 'bytes' } });
    f.emit('turn/completed', { threadId: 'image', turn: { id: 'turn', status: 'failed', error: { message: 'usage limit' } } });
    await expect(promise).rejects.toThrow('usage limit');
  });
});
