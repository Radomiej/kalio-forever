import { describe, expect, it, vi } from 'vitest';
import {
  CodexAppServerHost,
  CodexAppServerProtocolRouter,
  buildCodexAppServerArgs,
  buildCodexSpawnSpec,
  type CodexAppServerConnection,
} from './codex-app-server.host';

describe('CodexAppServerProtocolRouter', () => {
  it('blocks inherited Codex MCP servers unless explicitly opted in', () => {
    expect(buildCodexAppServerArgs(['multi_agent'], false, ['vscode_lsp', 'mcp-playwright-orchestrator'])).toEqual([
      'app-server',
      '--stdio',
      '-c',
      'mcp_servers."vscode_lsp".enabled=false',
      '-c',
      'mcp_servers."mcp-playwright-orchestrator".enabled=false',
      '--disable',
      'multi_agent',
    ]);
    expect(buildCodexAppServerArgs(['multi_agent'], true, ['vscode_lsp'])).toEqual([
      'app-server',
      '--stdio',
      '--disable',
      'multi_agent',
    ]);
  });

  it('runs Windows command shims through ComSpec instead of spawning .cmd directly', () => {
    expect(buildCodexSpawnSpec('codex.cmd', ['app-server', '--stdio'], 'win32', 'C:\\Windows\\System32\\cmd.exe')).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'codex.cmd', 'app-server', '--stdio'],
      windowsVerbatimArguments: true,
    });
  });

  it('resolves JSON-RPC responses and routes server requests', async () => {
    const router = new CodexAppServerProtocolRouter();
    const resolved = vi.fn();
    router.registerPending('7', { resolve: resolved, reject: vi.fn() });
    const request = vi.fn();
    router.onRequest(request);

    router.handle({ id: 7, result: { thread: { id: 'thread-1' } } });
    router.handle({ id: 'approval-1', method: 'item/tool/call', params: { callId: 'call-1' } });

    expect(resolved).toHaveBeenCalledWith({ thread: { id: 'thread-1' } });
    expect(request).toHaveBeenCalledWith({
      id: 'approval-1',
      method: 'item/tool/call',
      params: { callId: 'call-1' },
    });
  });

  it('rejects all pending requests when the process exits', async () => {
    const router = new CodexAppServerProtocolRouter();
    const reject = vi.fn();
    router.registerPending('1', { resolve: vi.fn(), reject });

    router.rejectAll(new Error('process exited'));

    expect(reject).toHaveBeenCalledWith(expect.objectContaining({ message: 'process exited' }));
  });

  it('tracks native Codex threads and clears them on reset', async () => {
    const host = new CodexAppServerHost();

    expect(host.getStatus('chatgpt-default')).toMatchObject({
      authProfileId: 'chatgpt-default',
      status: 'offline',
      connected: false,
      openSessionCount: 0,
    });

    host.registerThread('chatgpt-default', 'thread-1');
    host.registerThread('chatgpt-default', 'thread-2');
    expect(host.getStatus('chatgpt-default').openSessionCount).toBe(2);

    host.unregisterThread('chatgpt-default', 'thread-1');
    expect(host.getStatus('chatgpt-default').openSessionCount).toBe(1);

    await host.reset('chatgpt-default');
    expect(host.getStatus('chatgpt-default')).toMatchObject({
      status: 'offline',
      connected: false,
      openSessionCount: 0,
    });
  });

  it('does not resurrect a process that reset invalidated while it was starting', async () => {
    let resolveFirst!: (connection: CodexAppServerConnection) => void;
    let resolveSecond!: (connection: CodexAppServerConnection) => void;
    const firstStart = new Promise<CodexAppServerConnection>((resolve) => { resolveFirst = resolve; });
    const secondStart = new Promise<CodexAppServerConnection>((resolve) => { resolveSecond = resolve; });
    const first = makeConnection('epoch-first');
    const second = makeConnection('epoch-second');
    const factory = vi.fn()
      .mockImplementationOnce(() => firstStart)
      .mockImplementationOnce(() => secondStart);
    const host = new CodexAppServerHost(undefined, factory);

    const firstRequest = host.getConnection('chatgpt-default', 'read-only');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(factory).toHaveBeenCalledOnce();

    const reset = host.reset('chatgpt-default');
    const secondRequest = host.getConnection('chatgpt-default', 'read-only');
    resolveFirst(first);
    await expect(firstRequest).rejects.toThrow('was reset while starting');
    await reset;

    resolveSecond(second);
    await expect(secondRequest).resolves.toBe(second);
    expect(host.getStatus('chatgpt-default')).toMatchObject({ status: 'online', connected: true });
    expect(first.close).toHaveBeenCalledOnce();
  });
});

function makeConnection(processEpoch: string): CodexAppServerConnection {
  return {
    processEpoch,
    request: vi.fn(async () => undefined),
    notify: vi.fn(),
    respond: vi.fn(),
    onRequest: vi.fn(() => () => undefined),
    onNotification: vi.fn(() => () => undefined),
    close: vi.fn(async () => undefined),
    isClosed: () => false,
  };
}
