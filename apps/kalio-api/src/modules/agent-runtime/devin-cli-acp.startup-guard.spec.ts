import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DevinCliConfigHandle } from './devin-cli-config';
import type { DevinCliAcpLifecycle } from './devin-cli-acp.lifecycle';
import * as processShutdown from './devin-cli-process-shutdown';
import { methods } from '@agentclientprotocol/sdk';
const mocks = vi.hoisted(() => ({ cleanup: vi.fn(), suppress: vi.fn(), spawn: vi.fn(), create: vi.fn(), connect: vi.fn(), initialize: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), spawn: mocks.spawn,
}));
vi.mock('./devin-cli-config', () => ({ createDevinCliConfig: mocks.create }));
vi.mock('@agentclientprotocol/sdk', async (original) => ({
  ...await original<typeof import('@agentclientprotocol/sdk')>(),
  client: () => {
    const app = { onRequest: () => app, onNotification: () => app, connect: mocks.connect };
    return app;
  },
}));
vi.mock('./devin-cli-mcp-catalog', () => ({ suppressInheritedDevinMcp: mocks.suppress }));
vi.mock('./devin-cli-model-catalog.service', async (original) => ({
  ...await original<typeof import('./devin-cli-model-catalog.service')>(), resolveDevinCliPath: () => 'devin.exe',
}));
import { DevinAcpHost, DevinAcpHostRegistry } from './devin-cli-acp.host';
const workspace = resolve('startup-guard-workspace');
const hosts: DevinAcpHost[] = [];
const children: ReturnType<typeof childFixture>[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function childFixture() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null as number | null, signalCode: null as NodeJS.Signals | null,
    kill: vi.fn(() => true),
  });
  let closed = false;
  return Object.assign(child, { finish: () => {
    if (closed) return;
    closed = true;
    child.exitCode = 0;
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    child.emit('close', 0, null);
  } });
}

function hostFixture() {
  const host = new DevinAcpHost('swe-2');
  hosts.push(host);
  return host;
}

function transportFixture() {
  const closed = deferred<void>();
  const interrupted = deferred<never>();
  void interrupted.promise.catch(() => undefined);
  const controller = new AbortController();
  return {
    signal: controller.signal, closed: closed.promise,
    close: vi.fn(() => { controller.abort(); closed.resolve(); interrupted.reject(new Error('transport closed')); }),
    agent: { request: vi.fn((method: string) => method === methods.agent.initialize
      ? Promise.race([mocks.initialize(), interrupted.promise])
      : Promise.resolve({ sessionId: 'fixture', configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'swe-2', options: [{ value: 'swe-2', name: 'SWE-2' }] }] })) },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cleanup.mockResolvedValue(undefined);
  mocks.suppress.mockResolvedValue(0);
  mocks.create.mockResolvedValue({ cwd: 'private', path: 'private/config', cleanup: mocks.cleanup, suppressMcpServers: vi.fn() });
  mocks.spawn.mockImplementation(() => { const child = childFixture(); children.push(child); return child; });
  mocks.initialize.mockResolvedValue({ agentCapabilities: {} });
  mocks.connect.mockImplementation(transportFixture);
});
afterEach(async () => {
  children.splice(0).forEach(child => child.finish());
  for (const host of hosts.splice(0)) await host.close();
});
describe('ACP startup configuration guard', () => {
  it('retains ownership when termination rejects after child close and recovers only through registry reset', async () => {
    const initializationError = new Error('initialize fixture failure');
    const termination = deferred<void>();
    const stop = vi.spyOn(processShutdown, 'stopDevinChild').mockImplementation(() => termination.promise);
    const child = childFixture(); children.push(child);
    const transport = transportFixture();
    const config = { cwd: 'private', path: 'private/config', cleanup: mocks.cleanup, suppressMcpServers: vi.fn() };
    mocks.create.mockResolvedValueOnce(config);
    mocks.spawn.mockReturnValueOnce(child);
    mocks.connect.mockReturnValueOnce(transport);
    mocks.initialize.mockRejectedValueOnce(initializationError);
    const registry = new DevinAcpHostRegistry({} as never);
    const host = await registry.get('swe-2', 'late-termination-fixture');
    hosts.push(host);
    const starting = host.ensureSession(workspace).catch(error => error);
    try {
      await vi.waitFor(() => expect(stop).toHaveBeenCalledExactlyOnceWith(child));
      expect(mocks.cleanup).not.toHaveBeenCalled();
      child.finish();
      transport.close();
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(mocks.cleanup).not.toHaveBeenCalled();
      termination.reject(new Error('unconfirmed tree termination fixture'));
      expect(await starting).toBe(initializationError);
      const owned = (host as unknown as { lifecycle: DevinCliAcpLifecycle }).lifecycle;
      expect(owned.child).toBe(child);
      expect(owned.connection).toBe(transport);
      expect(owned.config).toBe(config);
      expect(mocks.cleanup).not.toHaveBeenCalled();
      await expect(host.ensureSession(workspace)).rejects.toThrow(/cleanup|reset/i);
      expect(await registry.get('swe-2', 'late-termination-fixture')).toBe(host);
      expect(mocks.create).toHaveBeenCalledTimes(1);
      expect(mocks.spawn).toHaveBeenCalledTimes(1);
      await registry.reset();
      expect(mocks.cleanup).toHaveBeenCalledTimes(1);
      expect(owned.hasResources).toBe(false);
      expect(stop).toHaveBeenCalledTimes(1);
      const replacement = await registry.get('swe-2', 'late-termination-fixture');
      expect(replacement).not.toBe(host);
      expect(replacement.getStatus().status).toBe('offline');
      await registry.reset();
      expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    } finally {
      termination.resolve();
      child.finish();
      transport.close();
      try { await starting; await registry.reset(); }
      finally { stop.mockRestore(); }
    }
  });

  it('deletes both real config copies after injected initialize rejection', async () => {
    let config!: DevinCliConfigHandle;
    mocks.create.mockImplementationOnce(async (...args: Parameters<typeof import('./devin-cli-config').createDevinCliConfig>) => {
      const actual = await vi.importActual<typeof import('./devin-cli-config')>('./devin-cli-config');
      config = await actual.createDevinCliConfig(...args);
      return config;
    });
    const failure = new Error('initialize fixture failure');
    mocks.initialize.mockRejectedValueOnce(failure);
    const host = hostFixture();
    const starting = host.ensureSession(workspace, undefined, [{
      name: 'fixture-http', type: 'http', url: 'http://127.0.0.1/fixture',
      headers: [{ name: 'X-Fixture', value: 'synthetic-test-value' }],
    }]).catch(error => error);
    try {
      await vi.waitFor(() => expect(children[0]?.kill).toHaveBeenCalledTimes(1));
      expect((await stat(config.path)).isFile()).toBe(true);
      expect((await stat(join(config.cwd, '.devin', 'mcp_config.local.json'))).isFile()).toBe(true);
      children[0].finish();
      expect(await starting).toBe(failure);
      await expect(stat(config.path)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(join(config.cwd, '.devin', 'mcp_config.local.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      children[0]?.finish();
      await starting;
      await config?.cleanup();
    }
  });

  it('retains the allocated handle when preparation and its rollback both fail', async () => {
    const failure = new Error('configuration fixture failure');
    const config = { cwd: 'private', path: 'private/config', cleanup: mocks.cleanup, suppressMcpServers: vi.fn() };
    mocks.create.mockImplementationOnce(async (...args: Parameters<typeof import('./devin-cli-config').createDevinCliConfig>) => {
      args[3]?.(config);
      throw failure;
    });
    mocks.cleanup.mockRejectedValueOnce(new Error('locked fixture'));
    const host = hostFixture();
    await expect(host.ensureSession(workspace)).rejects.toBe(failure);
    await expect(host.ensureSession(workspace)).rejects.toThrow(/cleanup|reset/i);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).not.toHaveBeenCalled();
    await host.close();
    expect(mocks.cleanup).toHaveBeenCalledTimes(2);
  });

  it('retains a process whose termination fails and leaves its overlay for a reset retry', async () => {
    const failure = new Error('initialize fixture failure');
    const child = childFixture(); children.push(child);
    child.kill.mockReturnValueOnce(false);
    mocks.spawn.mockReturnValueOnce(child);
    mocks.initialize.mockRejectedValueOnce(failure);
    const host = hostFixture();
    await expect(host.ensureSession(workspace)).rejects.toBe(failure);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    await expect(host.ensureSession(workspace)).rejects.toThrow(/cleanup|reset/i);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    child.finish();
    await host.close();
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent reconnects after deferred disposal and ignores old callbacks', async () => {
    const transport = transportFixture();
    mocks.connect.mockReturnValueOnce(transport);
    const host = hostFixture();
    await host.ensureSession(workspace);
    const cleanup = deferred<void>();
    mocks.cleanup.mockReturnValueOnce(cleanup.promise);
    transport.close();
    children[0].finish();
    await vi.waitFor(() => expect(mocks.cleanup).toHaveBeenCalledTimes(1));
    const first = host.ensureSession(workspace);
    const second = host.ensureSession(workspace);
    cleanup.resolve();
    await Promise.all([first, second]);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    children[0].emit('exit', 0, null);
    expect(host.getStatus().status).toBe('online');
    expect(children[1].kill).not.toHaveBeenCalled();
  });

  it('cleans after an asynchronous spawn error without attempting to kill a missing process', async () => {
    const initialization = deferred<{ agentCapabilities: object }>();
    mocks.initialize.mockReturnValueOnce(initialization.promise);
    const host = hostFixture();
    const starting = host.ensureSession(workspace).catch(error => error);
    await vi.waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(1));
    const failure = new Error('spawn ENOENT fixture');
    children[0].kill.mockReturnValue(false);
    children[0].emit('error', failure);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(mocks.cleanup).not.toHaveBeenCalled();
    children[0].finish();
    expect(await starting).toBe(failure);
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(children[0].kill).not.toHaveBeenCalled();
  });

  it('rolls back a synchronous spawn failure before allowing a fresh startup', async () => {
    const failure = new Error('spawn fixture failure');
    mocks.spawn.mockImplementationOnce(() => { throw failure; });
    const host = hostFixture();
    await expect(host.ensureSession(workspace)).rejects.toBe(failure);
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    await expect(host.ensureSession(workspace)).resolves.toMatchObject({ sessionId: 'fixture' });
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it.each(['pipe', 'connect', 'initialize'])('waits for child close before overlay cleanup after %s failure', async (stage) => {
    const failure = new Error(`${stage} fixture failure`);
    const child = childFixture(); children.push(child);
    mocks.spawn.mockReturnValueOnce(child);
    if (stage === 'pipe') vi.spyOn(child.stdout, 'pipe').mockImplementationOnce(() => { throw failure; });
    if (stage === 'connect') mocks.connect.mockImplementationOnce(() => { throw failure; });
    if (stage === 'initialize') mocks.initialize.mockRejectedValueOnce(failure);
    const host = hostFixture();
    const starting = host.ensureSession(workspace);
    const rejected = expect(starting).rejects.toBe(failure);
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledTimes(1));
    expect(mocks.cleanup).not.toHaveBeenCalled();
    child.finish();
    await rejected;
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(host.getStatus().status).toBe('error');
  });

  it('retains a failed rollback and blocks replacement until reset retries cleanup', async () => {
    const failure = new Error('spawn fixture failure');
    mocks.spawn.mockImplementationOnce(() => { throw failure; });
    mocks.cleanup.mockRejectedValueOnce(new Error('locked fixture'));
    const host = hostFixture();
    await expect(host.ensureSession(workspace)).rejects.toBe(failure);
    await expect(host.ensureSession(workspace)).rejects.toThrow(/cleanup|reset/i);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await host.close();
    expect(mocks.cleanup).toHaveBeenCalledTimes(2);
  });

  it('does not publish a late initialize response after early transport closure', async () => {
    const initialization = deferred<{ agentCapabilities: object }>();
    mocks.initialize.mockReturnValueOnce(initialization.promise);
    const transport = transportFixture();
    mocks.connect.mockReturnValueOnce(transport);
    const host = hostFixture();
    const starting = host.ensureSession(workspace);
    const rejected = expect(starting).rejects.toThrow(/closed/i);
    await vi.waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(1));
    transport.close();
    await vi.waitFor(() => expect(children[0].kill).toHaveBeenCalledTimes(1));
    children[0].finish();
    initialization.resolve({ agentCapabilities: {} });
    await rejected;
    expect(host.getStatus().status).toBe('error');
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });

  it('joins initialization rollback with concurrent reset without deadlocking or double cleanup', async () => {
    const initialization = deferred<{ agentCapabilities: object }>();
    mocks.initialize.mockReturnValueOnce(initialization.promise);
    const host = hostFixture();
    const starting = host.ensureSession(workspace);
    const rejected = expect(starting).rejects.toThrow();
    await vi.waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(1));
    const closing = host.close();
    await vi.waitFor(() => expect(children[0].kill).toHaveBeenCalledTimes(1));
    children[0].finish();
    await Promise.all([rejected, closing]);
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(host.getStatus().status).toBe('offline');
  });

  it('waits for deferred config creation during reset and never spawns a child', async () => {
    const config = { cwd: 'private', path: 'private/config', cleanup: mocks.cleanup, suppressMcpServers: vi.fn() };
    const creation = deferred<typeof config>();
    mocks.create.mockReturnValueOnce(creation.promise);
    const host = hostFixture();
    const starting = host.ensureSession(workspace);
    const rejected = expect(starting).rejects.toThrow('closed during startup');
    const closing = host.close();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    creation.resolve(config);
    await Promise.all([rejected, closing]);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });
  it('cleans the private config and never starts ACP when catalog verification fails', async () => {
    mocks.suppress.mockRejectedValue(new Error('Configuration check failed; host startup blocked.'));
    const host = new DevinAcpHost('swe-2');
    await expect(host.ensureSession(workspace)).rejects.toThrow('host startup blocked');
    expect(host.getStatus().status).toBe('error');
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).not.toHaveBeenCalled();
    await host.close();
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });

  it('fences concurrent reset during preparation without spawning ACP', async () => {
    let finish!: (count: number) => void;
    mocks.suppress.mockImplementation(() => new Promise<number>(resolve => { finish = resolve; }));
    const host = new DevinAcpHost('swe-2');
    const starting = host.ensureSession(workspace);
    const rejected = expect(starting).rejects.toThrow('closed during startup');
    await vi.waitFor(() => expect(mocks.suppress).toHaveBeenCalledTimes(1));
    const closing = host.close();
    finish(16);
    await rejected;
    await closing;
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(host.getStatus().status).toBe('offline');
  });

  it('rejects relative workspaces before preparing configuration or spawning ACP', async () => {
    const host = new DevinAcpHost('swe-2');
    await expect(host.ensureSession('relative/workspace')).rejects.toThrow('absolute working directory');
    expect(mocks.suppress).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    await host.close();
  });
});
