import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerHost, CodexAppServerProtocolRouter, buildCodexAppServerArgs, buildCodexSpawnSpec } from './codex-app-server.host';

describe('CodexAppServerProtocolRouter', () => {
  it('blocks inherited Codex MCP servers unless explicitly opted in', () => {
    expect(buildCodexAppServerArgs(['multi_agent'], false)).toEqual([
      'app-server',
      '--stdio',
      '-c',
      'mcp_servers={}',
      '--disable',
      'multi_agent',
    ]);
    expect(buildCodexAppServerArgs(['multi_agent'], true)).toEqual([
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

    await host.reset('chatgpt-default');
    expect(host.getStatus('chatgpt-default')).toMatchObject({
      status: 'offline',
      connected: false,
      openSessionCount: 0,
    });
  });
});
