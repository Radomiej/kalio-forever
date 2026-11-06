import { describe, expect, it, vi, beforeEach } from 'vitest';
import { methods, type ClientConnection, type SessionConfigOption } from '@agentclientprotocol/sdk';
import { captureExecutionCurrent, guardedAcpRequest, runGuardedDevinPrompt } from './devin-cli-acp.execution-guard';
import { DevinAcpHost, type DevinAcpPromptInput } from './devin-cli-acp.host';
import { bindDevinSessionModel } from './devin-cli-acp.model-selection';

const io = vi.hoisted(() => ({ config: vi.fn(), exec: vi.fn(), spawn: vi.fn() }));
vi.mock('./devin-cli-config', () => ({ createDevinCliConfig: io.config }));
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  const execFile = vi.fn(); Object.defineProperty(execFile, promisify.custom, { value: io.exec });
  return { ...actual, execFile, spawn: io.spawn };
});
beforeEach(() => { vi.clearAllMocks(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function options(currentValue = 'exact-model'): SessionConfigOption[] {
  return [{ id: 'model', category: 'model', name: 'Model', type: 'select', currentValue,
    options: [{ value: 'other', name: 'Other' }, { value: 'exact-model', name: 'Exact' }] }];
}
function authority() {
  let current = true;
  const controller = new AbortController();
  const callback = vi.fn(() => { if (!current) throw new Error('private-authority-sentinel'); });
  const check = captureExecutionCurrent(callback, controller.signal)!;
  return { check, callback, controller, stale: () => { current = false; } };
}
function readyHost(request = vi.fn(async () => ({ stopReason: 'end_turn' as const }))) {
  const host = new DevinAcpHost('exact-model');
  const connection = { agent: { request, notify: vi.fn(async () => undefined) } } as unknown as ClientConnection;
  const session = { configOptions: options(), cwd: 'C:/fixture', processEpoch: 'epoch', mcpServers: [], tail: Promise.resolve() };
  const internals = host as unknown as { ensureConnection: () => Promise<ClientConnection>;
    processEpoch: string; sessions: Map<string, typeof session> };
  internals.ensureConnection = vi.fn(async () => connection); internals.processEpoch = 'epoch';
  internals.sessions.set('session', session);
  return { host, connection, session, internals, request };
}
const promptInput = (): DevinAcpPromptInput => ({ onText: vi.fn(), onThought: vi.fn(), onPermission: async () => 'decline' });

it.each([false, true])('sends attachments only if Devin advertises image input (%s)', async (image) => {
  const { host, request } = readyHost();
  const settings = host as unknown as { capabilities: { promptCapabilities: { image: boolean } } };
  settings.capabilities = { promptCapabilities: { image } };
  const attachment = { type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' };
  const turn = host.prompt('session', 'Describe this', { ...promptInput(), images: [attachment] });
  if (image) {
    await expect(turn).resolves.toBe('end_turn');
    expect(request).toHaveBeenCalledWith(methods.agent.session.prompt, {
      sessionId: 'session', prompt: [{ type: 'text', text: 'Describe this' }, attachment],
    }, undefined);
  } else {
    await expect(turn).rejects.toThrow('does not accept image attachments');
    expect(request).not.toHaveBeenCalled();
  }
});

describe('strict synchronous execution-current contract', () => {
  it('accepts only undefined and never awaits or inspects thenables', async () => {
    expect(captureExecutionCurrent(undefined)).toBeUndefined();
    expect(captureExecutionCurrent(() => undefined)!()).toBeUndefined();
    const then = vi.fn();
    for (const result of [null, false, 1, 'permission', { then }, Promise.resolve(), Promise.reject(new Error('private'))])
      expect(() => captureExecutionCurrent(() => result)!()).toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/);
    expect(then).not.toHaveBeenCalled();
    let called = false;
    expect(() => captureExecutionCurrent(async () => { called = true; })).toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/);
    expect(called).toBe(false);
    await Promise.resolve(); // Rejected native Promise was quarantined, never authority.
  });
  it('checks abort both before and after callback and redacts callback errors', () => {
    const a = authority(); a.controller.abort();
    expect(a.check).toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/); expect(a.callback).not.toHaveBeenCalled();
    const controller = new AbortController();
    expect(() => captureExecutionCurrent(() => { controller.abort(); }, controller.signal)!())
      .toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/);
    expect(() => captureExecutionCurrent(() => { throw new Error('private'); })!()).toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/);
  });
  it('checks immediately before RPC and after deferred reply', async () => {
    const a = authority(); const reply = deferred<string>(); const rpc = vi.fn(() => reply.promise);
    const running = guardedAcpRequest(a.check, rpc); a.stale(); reply.resolve('not-authority');
    await expect(running).rejects.toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/);
    rpc.mockClear(); await expect(guardedAcpRequest(a.check, rpc)).rejects.toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('host setup and session boundaries', () => {
  const catalog = [
    'devin 3000.11.1',
    'Configured MCP servers:\n  • inherited\n    Command: private-command\n',
    'Configured MCP servers:\n  ✗ inherited  (disabled)\n    Command: private-command\n',
  ];
  function setup() {
    const config = { path: 'C:/private/config', cwd: 'C:/private', suppressMcpServers: vi.fn(async (): Promise<void> => undefined),
      cleanup: vi.fn(async () => undefined) };
    io.config.mockImplementation(async (_model, _servers, _policy, allocated) => { allocated(config); return config; });
    return config;
  }
  it('staleness during private config preparation prevents every catalog exec/spawn and cleans own config', async () => {
    const config = setup(); const gate = deferred<typeof config>(); const a = authority();
    io.config.mockImplementationOnce(async (_model, _servers, _policy, allocated) => { allocated(config); return gate.promise; });
    const running = new DevinAcpHost('exact-model').ensureSession('C:/fixture', undefined, [], a.check);
    await vi.waitFor(() => expect(io.config).toHaveBeenCalledTimes(1));
    a.stale(); gate.resolve(config);
    await expect(running).rejects.toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/);
    expect(io.exec).not.toHaveBeenCalled(); expect(io.spawn).not.toHaveBeenCalled(); expect(config.cleanup).toHaveBeenCalledTimes(1);
  });
  it.each([0, 1, 2])('staleness after catalog stage %s prevents all later process effects', async stage => {
    const config = setup(); const a = authority(); const reply = deferred<{ stdout: string; stderr: string }>();
    io.exec.mockReset();
    for (let index = 0; index <= stage; index++)
      if (index === stage) io.exec.mockImplementationOnce(() => reply.promise);
      else io.exec.mockResolvedValueOnce({ stdout: catalog[index], stderr: '' });
    const running = new DevinAcpHost('exact-model').ensureSession('C:/fixture', undefined, [], a.check);
    await vi.waitFor(() => expect(io.exec).toHaveBeenCalledTimes(stage + 1));
    a.stale(); reply.resolve({ stdout: catalog[stage]!, stderr: '' });
    await expect(running).rejects.toThrow('host startup blocked');
    expect(io.exec).toHaveBeenCalledTimes(stage + 1); expect(io.spawn).not.toHaveBeenCalled();
    expect(config.cleanup).toHaveBeenCalledTimes(1);
  });
  it('abort during suppression prevents verification exec and spawn', async () => {
    const config = setup(); const gate = deferred<void>(); const a = authority();
    config.suppressMcpServers.mockImplementation(() => gate.promise);
    io.exec.mockReset().mockResolvedValueOnce({ stdout: catalog[0], stderr: '' })
      .mockResolvedValueOnce({ stdout: catalog[1], stderr: '' });
    const running = new DevinAcpHost('exact-model').ensureSession('C:/fixture', undefined, [], a.check);
    await vi.waitFor(() => expect(config.suppressMcpServers).toHaveBeenCalledTimes(1));
    a.controller.abort(); gate.resolve();
    await expect(running).rejects.toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/);
    expect(io.exec).toHaveBeenCalledTimes(2); expect(io.spawn).not.toHaveBeenCalled(); expect(config.cleanup).toHaveBeenCalledTimes(1);
  });
  it('stale connection wait prevents session/new', async () => {
    const f = readyHost(); const gate = deferred<ClientConnection>(); const a = authority();
    f.internals.ensureConnection = vi.fn(() => gate.promise);
    const running = f.host.ensureSession('C:/fixture', undefined, [], a.check);
    a.stale(); gate.resolve(f.connection);
    await expect(running).rejects.toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/); expect(f.request).not.toHaveBeenCalled();
  });
  it('stale model-set reply is not published as a host session', async () => {
    const model = deferred<{ configOptions: SessionConfigOption[] }>(); const a = authority();
    const request = vi.fn().mockResolvedValueOnce({ sessionId: 'new-session', configOptions: options('other') })
      .mockImplementationOnce(() => model.promise);
    const f = readyHost(request);
    const running = f.host.ensureSession('C:/fixture', undefined, [], a.check);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    a.stale(); model.resolve({ configOptions: options() });
    await expect(running).rejects.toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/);
    expect(f.internals.sessions.has('new-session')).toBe(false);
  });
  it('checks after beforeSet and never issues model RPC with stale authority', async () => {
    const f = readyHost(); const a = authority();
    await expect(bindDevinSessionModel(f.connection, 'session', 'exact-model', options('other'), a.stale, a.check))
      .rejects.toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/);
    expect(f.request).not.toHaveBeenCalled();
  });
});

describe('queued prompt and exact-owner cleanup', () => {
  it.each(['stale', 'abort'])('captures guard before queue and blocks %s before prompt RPC', async mode => {
    const f = readyHost(); const queue = deferred<void>(); f.session.tail = queue.promise; const a = authority();
    const input = { ...promptInput(), signal: a.controller.signal, assertExecutionCurrent: a.check };
    const running = f.host.prompt('session', 'private prompt', input);
    input.assertExecutionCurrent = () => undefined;
    if (mode === 'stale') a.stale(); else a.controller.abort();
    queue.resolve();
    await expect(running).rejects.toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/);
    expect(f.request).not.toHaveBeenCalled(); expect('active' in f.session).toBe(false);
  });
  it('checks again after queued ensureConnection await', async () => {
    const f = readyHost(); const a = authority(); const gate = deferred<ClientConnection>();
    f.internals.ensureConnection = vi.fn(() => gate.promise);
    const running = f.host.prompt('session', 'private prompt', { ...promptInput(), assertExecutionCurrent: a.check });
    await vi.waitFor(() => expect(f.internals.ensureConnection).toHaveBeenCalled());
    a.stale(); gate.resolve(f.connection);
    await expect(running).rejects.toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/); expect(f.request).not.toHaveBeenCalled();
  });
  it('onTurnStart failure leaves no active record or listener and sends no prompt', async () => {
    const f = readyHost(); const session: { active?: unknown } = {};
    const controller = new AbortController(); const add = vi.spyOn(controller.signal, 'addEventListener');
    await expect(runGuardedDevinPrompt(f.connection, session as never, 'session', 'private', {
      ...promptInput(), signal: controller.signal, onTurnStart: () => { throw new Error('hook failure'); },
    })).rejects.toThrow('hook failure');
    expect(session.active).toBeUndefined(); expect(add).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it('ordinary host hook failure clears active and leaves next queued turn safe with MCP release ordering', async () => {
    const f = readyHost(); const session = f.session as typeof f.session & { active?: unknown };
    await expect(f.host.prompt('session', 'first', { ...promptInput(),
      onTurnStart: () => { throw new Error('ordinary hook failed'); } })).rejects.toThrow('ordinary hook failed');
    expect(f.request).not.toHaveBeenCalled(); expect(session.active).toBeUndefined();
    const releaseMcp = vi.fn(() => { expect(session.active).toBeDefined(); });
    await expect(f.host.prompt('session', 'next', { ...promptInput(), onTurnStart: () => releaseMcp })).resolves.toBe('end_turn');
    expect(f.request).toHaveBeenCalledTimes(1); expect(releaseMcp).toHaveBeenCalledTimes(1);
    expect(session.active).toBeUndefined();
  });
  it('guard failure after hook releases own turn and listener without RPC', async () => {
    const f = readyHost(); const a = authority(); const session = {}; const release = vi.fn();
    const remove = vi.spyOn(a.controller.signal, 'removeEventListener');
    await expect(runGuardedDevinPrompt(f.connection, session, 'session', 'private', { ...promptInput(), signal: a.controller.signal,
      onTurnStart: () => { a.stale(); return release; } }, a.check)).rejects.toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/);
    expect(release).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
    expect((session as { active?: unknown }).active).toBeUndefined();
  });
  it('ordinary prompt still completes and releases exact owner', async () => {
    const f = readyHost(); const release = vi.fn();
    await expect(f.host.prompt('session', 'ordinary', { ...promptInput(), onTurnStart: () => release })).resolves.toBe('end_turn');
    expect(f.request).toHaveBeenCalledWith(methods.agent.session.prompt, expect.objectContaining({ sessionId: 'session' }), undefined);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('preserves guard failure when release also fails and still clears own active state', async () => {
    const f = readyHost(); const a = authority(); const session = {};
    await expect(runGuardedDevinPrompt(f.connection, session, 'session', 'private', { ...promptInput(),
      onTurnStart: () => { a.stale(); return () => { throw new Error('private-cleanup-sentinel'); }; } }, a.check))
      .rejects.toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/);
    expect((session as { active?: unknown }).active).toBeUndefined(); expect(f.request).not.toHaveBeenCalled();
  });
  it('rejects stale prompt response and does not clean a replacement active owner', async () => {
    const reply = deferred<{ stopReason: 'end_turn' }>(); const f = readyHost(vi.fn(() => reply.promise));
    const a = authority(); const foreign = { ...promptInput(), rejectConnection: vi.fn() };
    const session: { active?: typeof foreign } = {};
    const running = runGuardedDevinPrompt(f.connection, session, 'session', 'private', promptInput(), a.check);
    session.active = foreign; a.stale(); reply.resolve({ stopReason: 'end_turn' });
    await expect(running).rejects.toThrow(/^EXECUTION_CURRENT_UNAVAILABLE$/);
    expect(session.active).toBe(foreign);
  });
});
