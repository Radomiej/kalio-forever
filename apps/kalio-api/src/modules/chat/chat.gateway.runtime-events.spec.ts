import { describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '@kalio/types';
import type { Socket } from 'socket.io';
import { emitRuntimeEventToSubscribers, enqueueSessionEvent } from './chat.gateway.runtime-events';

const request = { sessionId: 'child', requestId: 'request', toolCallId: 'call', toolName: 'fs_write',
  args: { path: 'index.html', content: 'private content' }, timeoutMs: 0 };
function fixture(chain: Record<string, string | undefined> = { child: 'root', root: 'host', host: undefined }) {
  const child = { emit: vi.fn() };
  const host = { emit: vi.fn() };
  const outsider = { emit: vi.fn() };
  const clients = new Map([['child-socket', child], ['host-socket', host], ['outsider', outsider]]) as unknown as Map<string, Socket>;
  const sessionSubscribers = new Map([
    ['child', new Set(['child-socket', 'host-socket'])], ['host', new Set(['host-socket'])],
    ['unrelated', new Set(['outsider'])],
  ]);
  const get = vi.fn(async (id: string) => {
    if (!Object.hasOwn(chain, id)) throw new Error('not found');
    return { id, parentSessionId: chain[id] } as ChatSession;
  });
  const logger = { warn: vi.fn() };
  return { child, host, outsider, get, logger, clients, sessionSubscribers,
    input: { clients, sessionSubscribers, sessionsService: { get }, logger } };
}

describe('runtime ancestry relay', () => {
  it('delivers once to the union of durable ancestors and child subscribers, never trusting claimed hosts', async () => {
    const f = fixture();
    const payload = { ...request, architectureContext: { hostSessionId: 'unrelated' } };
    await emitRuntimeEventToSubscribers({ ...f.input, event: 'tool:confirmation_required', payload });
    expect(f.get.mock.calls.map(([id]) => id)).toEqual(['child', 'root', 'host']);
    expect(f.child.emit).toHaveBeenCalledExactlyOnceWith('tool:confirmation_required', payload);
    expect(f.host.emit).toHaveBeenCalledExactlyOnceWith('tool:confirmation_required', payload);
    expect(f.outsider.emit).not.toHaveBeenCalled();
    expect([...f.sessionSubscribers.keys()]).toEqual(['child', 'host', 'unrelated']);
  });

  it.each([
    { child: 'missing' }, { child: 'root', root: 'child' }, { child: 'root', root: 'missing' },
  ])('fails closed on unresolved or cyclic chains without partial direct/host delivery: %j', async (chain) => {
    const f = fixture(chain);
    await emitRuntimeEventToSubscribers({ ...f.input, event: 'tool:confirmation_required', payload: request });
    expect(f.child.emit).not.toHaveBeenCalled();
    expect(f.host.emit).not.toHaveBeenCalled();
    expect(f.outsider.emit).not.toHaveBeenCalled();
    expect(f.logger.warn).toHaveBeenCalledOnce();
  });

  it('drops missing or mismatched actual identity with diagnostics', async () => {
    const f = fixture();
    await emitRuntimeEventToSubscribers({ ...f.input, event: 'tool:confirmation_required', payload: { ...request, sessionId: '' } });
    f.get.mockResolvedValueOnce({ id: 'wrong' } as ChatSession);
    await emitRuntimeEventToSubscribers({ ...f.input, event: 'tool:confirmation_required', payload: request });
    expect(f.child.emit).not.toHaveBeenCalled();
    expect(f.host.emit).not.toHaveBeenCalled();
    expect(f.logger.warn).toHaveBeenCalledTimes(2);
  });

  it('rejects a whitespace parent before any direct or ancestor delivery', async () => {
    const f = fixture({ child: 'root', root: '   ' });
    await emitRuntimeEventToSubscribers({ ...f.input, event: 'tool:confirmation_required', payload: request });
    expect(f.get.mock.calls.map(([id]) => id)).toEqual(['child', 'root']);
    expect(f.child.emit).not.toHaveBeenCalled();
    expect(f.host.emit).not.toHaveBeenCalled();
    expect(f.outsider.emit).not.toHaveBeenCalled();
    expect(f.logger.warn).toHaveBeenCalledWith(expect.stringContaining('invalid parent identity'));
  });

  it.each(['session:created', 'session:updated'] as const)('leaves %s on its existing lifecycle channel', async (event) => {
    const f = fixture();
    await emitRuntimeEventToSubscribers({ ...f.input, event, payload: { id: 'child', personaId: 'default',
      title: 'Child', parentSessionId: 'host', createdAt: 1, updatedAt: 1 } });
    expect(f.get).not.toHaveBeenCalled();
    expect(f.child.emit).not.toHaveBeenCalled();
    expect(f.host.emit).not.toHaveBeenCalled();
    expect(f.outsider.emit).not.toHaveBeenCalled();
    expect(f.logger.warn).not.toHaveBeenCalled();
  });

  it('logs a non-Error lookup rejection and fails closed', async () => {
    const f = fixture();
    f.get.mockRejectedValueOnce('lookup rejected without Error');
    await emitRuntimeEventToSubscribers({ ...f.input, event: 'tool:confirmation_required', payload: request });
    expect(f.child.emit).not.toHaveBeenCalled();
    expect(f.host.emit).not.toHaveBeenCalled();
    expect(f.outsider.emit).not.toHaveBeenCalled();
    expect(f.logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Runtime event tool:confirmation_required dropped for session=child: lookup rejected without Error',
    );
  });

  it('serializes pending/cancel and recovers after a failed relay without losing the next event', async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const invalidated = { sessionId: 'child', requestId: 'request', toolCallId: 'call', reason: 'cancelled' as const };
    let queue = Promise.resolve();
    queue = enqueueSessionEvent(queue, async () => { await gate;
      await emitRuntimeEventToSubscribers({ ...f.input, event: 'tool:confirmation_required', payload: request });
    }, f.logger);
    queue = enqueueSessionEvent(queue, async () => { throw new Error('relay failure'); }, f.logger);
    queue = enqueueSessionEvent(queue, () => emitRuntimeEventToSubscribers({ ...f.input,
      event: 'tool:confirmation_invalidated', payload: invalidated }), f.logger);
    await Promise.resolve();
    expect(f.host.emit).not.toHaveBeenCalled();
    release();
    await queue;
    expect(f.host.emit.mock.calls).toEqual([
      ['tool:confirmation_required', request], ['tool:confirmation_invalidated', invalidated],
    ]);
    expect(f.logger.warn).toHaveBeenCalledWith(expect.stringContaining('relay failure'));
  });
});
