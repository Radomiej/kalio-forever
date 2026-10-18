import { EventEmitter, getEventListeners } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerHost, CodexAppServerProtocolRouter } from './codex-app-server.host';
import { readCodexModels } from './codex-model-catalog';

const transport = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('./codex-app-server-process', async (importOriginal) => ({
  ...await importOriginal<typeof import('./codex-app-server-process')>(),
  listConfiguredCodexMcpServers: async () => [],
  spawnCodexAppServerProcess: transport.spawn,
}));

interface WireRequest {
  id: string;
  method: string;
  params: unknown;
}

describe('Codex catalog timeout with the real stdio connection and protocol router', () => {
  let host: CodexAppServerHost;
  let routers: CodexAppServerProtocolRouter[];
  let stdout: PassThrough;
  let stderr: PassThrough;
  let stdin: Writable;
  let requests: WireRequest[];
  let kill: ReturnType<typeof vi.fn>;
  let child: EventEmitter;

  function pendingCount(): number {
    const router = routers.at(-1);
    expect(router).toBeInstanceOf(CodexAppServerProtocolRouter);
    const pending: unknown = Reflect.get(router!, 'pending');
    if (!(pending instanceof Map)) throw new Error('Expected the actual router pending map');
    return pending.size;
  }

  function respond(id: string, result: unknown): void {
    stdout.write(`${JSON.stringify({ id, result })}\n`);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    requests = [];
    routers = [];
    stdout = new PassThrough();
    stderr = new PassThrough();
    kill = vi.fn();
    stdin = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        const message = JSON.parse(chunk.toString()) as WireRequest;
        if (message.method === 'initialize') respond(message.id, {});
        else if (message.id !== undefined) requests.push(message);
        callback();
      },
    });
    child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill });
    transport.spawn.mockResolvedValue(child);
    const registerPending = CodexAppServerProtocolRouter.prototype.registerPending;
    vi.spyOn(CodexAppServerProtocolRouter.prototype, 'registerPending').mockImplementation(function (
      this: CodexAppServerProtocolRouter, ...args: Parameters<typeof registerPending>
    ) {
      routers.push(this);
      registerPending.apply(this, args);
    });
    host = new CodexAppServerHost();
  });

  afterEach(async () => {
    await host.close();
    stdin.destroy();
    stdout.destroy();
    stderr.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reclaims each timed-out catalog request without resetting the working host', async () => {
    const connection = await host.getConnection('catalog-test', 'read-only');
    for (let attempt = 0; attempt < 3; attempt++) {
      const rejected = expect(readCodexModels(connection)).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(15_000);
      await rejected;
      expect.soft(pendingCount(), `pending after timeout ${attempt + 1}`).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }
    expect(requests.map(({ method }) => method)).toEqual(['model/list', 'model/list', 'model/list']);
    expect(connection.isClosed?.()).toBe(false);
    expect(kill).not.toHaveBeenCalled();
    expect(await host.getConnection('catalog-test', 'read-only')).toBe(connection);
  });

  it('ignores late replies without leaving pending work, listeners or timers and remains usable', async () => {
    const connection = await host.getConnection('catalog-test', 'read-only');
    const listeners = [stdout.listenerCount('data'), stderr.listenerCount('data')];
    const rejected = expect(readCodexModels(connection)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect.soft(pendingCount(), 'pending before late response').toBe(0);
    respond(requests[0]!.id, { data: [{ model: 'late' }], nextCursor: null });
    respond(requests[0]!.id, { data: [{ model: 'duplicate' }], nextCursor: null });
    expect(pendingCount()).toBe(0);
    const next = connection.request('thread/read', { threadId: 'working-thread' });
    respond(requests[1]!.id, { thread: { id: 'working-thread' } });
    await expect(next).resolves.toEqual({ thread: { id: 'working-thread' } });
    expect(pendingCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect([stdout.listenerCount('data'), stderr.listenerCount('data')]).toEqual(listeners);
    expect(kill).not.toHaveBeenCalled();
  });

  it('preserves model filtering, pagination and prompt response cleanup', async () => {
    const connection = await host.getConnection('catalog-test', 'read-only');
    const read = readCodexModels(connection);
    respond(requests[0]!.id, {
      data: [{ model: 'current' }, { model: 'hidden', hidden: true }], nextCursor: 'page-2',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(requests.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: 'model/list', params: { limit: 100, includeHidden: false } },
      { method: 'model/list', params: { limit: 100, includeHidden: false, cursor: 'page-2' } },
    ]);
    respond(requests[1]!.id, { data: [{ model: 'current' }, { model: 'other' }], nextCursor: null });
    await expect(read).resolves.toEqual(['current', 'other']);
    expect(pendingCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  async function startRequest(signal: AbortSignal) {
    const connection = await host.getConnection('catalog-test', 'read-only');
    const request: (method: string, params: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>
      = connection.request.bind(connection);
    return { connection, request: () => request('thread/read', {}, { signal }) };
  }

  it('does not write or register a pre-aborted request', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled before write');
    controller.abort(reason);
    const { request } = await startRequest(controller.signal);
    const result = request();
    expect.soft(requests).toHaveLength(0);
    expect.soft(pendingCount()).toBe(0);
    // Release the old implementation's pending promise so RED never hangs.
    await host.close();
    await expect(result).rejects.toBe(reason);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it.each(['response', 'rpc-error', 'write-throw', 'write-callback', 'close', 'exit', 'error'] as const)(
    'removes pending and the abort listener on %s', async (completion) => {
      const controller = new AbortController();
      const { connection, request } = await startRequest(controller.signal);
      const error = new Error('transport failed');
      if (completion === 'write-throw') {
        vi.spyOn(stdin, 'write').mockImplementationOnce(() => { throw error; });
      } else if (completion === 'write-callback') {
        vi.spyOn(stdin, 'write').mockImplementationOnce((_chunk, encodingOrCallback, callback) => {
          const onWrite = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
          onWrite?.(error);
          return false;
        });
      }
      const result = request();
      const settled = result.then(value => ({ value }), failure => ({ failure: failure as unknown }));
      if (completion !== 'write-throw' && completion !== 'write-callback') {
        expect.soft(getEventListeners(controller.signal, 'abort')).toHaveLength(1);
        expect(pendingCount()).toBe(1);
      }
      if (completion === 'response') respond(requests[0]!.id, { ok: true });
      if (completion === 'rpc-error') stdout.write(`${JSON.stringify({ id: requests[0]!.id, error: { message: 'rpc failed' } })}\n`);
      if (completion === 'close') await connection.close();
      if (completion === 'exit') child.emit('exit', 1, null);
      if (completion === 'error') child.emit('error', error);
      expect.soft(pendingCount()).toBe(0);
      expect.soft(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
      // Ensure cleanup also runs on the old callback-ignoring implementation.
      await host.close();
      const outcome = await settled;
      if (completion === 'response') expect(outcome).toEqual({ value: { ok: true } });
      else if (completion === 'write-throw' || completion === 'write-callback' || completion === 'error') {
        expect(outcome).toEqual({ failure: error });
      } else expect(outcome).toHaveProperty('failure', expect.any(Error));
      controller.abort(new Error('late abort'));
      expect(pendingCount()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('aborts only its own request and ignores its late response', async () => {
    const controller = new AbortController();
    const { connection, request } = await startRequest(controller.signal);
    const result = request();
    const settled = result.then(value => ({ value }), failure => ({ failure: failure as unknown }));
    const other = connection.request('thread/read', { threadId: 'healthy' });
    expect(pendingCount()).toBe(2);
    const reason = new Error('cancel this request only');
    controller.abort(reason);
    expect.soft(pendingCount()).toBe(1);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    respond(requests[0]!.id, { stale: true });
    expect(pendingCount()).toBe(1);
    respond(requests[1]!.id, { thread: { id: 'healthy' } });
    await expect(other).resolves.toEqual({ thread: { id: 'healthy' } });
    expect(await settled).toEqual({ failure: reason });
    expect(pendingCount()).toBe(0);
    expect(connection.isClosed?.()).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });
});
