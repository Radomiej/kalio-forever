import { afterEach, describe, expect, it } from 'vitest';
import { buildKalioMcpBridgeHttpConfig, kalioMcpBridgeUrl } from './kalio-mcp-bridge-config';

describe('Kalio MCP bridge config', () => {
  afterEach(() => {
    delete process.env['KALIO_MCP_BRIDGE_TOKEN'];
    delete process.env['PORT'];
  });

  it('fails closed without a bridge token', () => {
    expect(buildKalioMcpBridgeHttpConfig({ sessionId: 'session-1', allowedToolNames: [] })).toBeNull();
  });

  it('builds a scoped ACP HTTP server config without leaking the token into the URL', () => {
    process.env['KALIO_MCP_BRIDGE_TOKEN'] = 'secret-token';
    process.env['PORT'] = '3316';
    expect(buildKalioMcpBridgeHttpConfig({
      sessionId: 'session-1',
      vfsSessionId: 'vfs-1',
      turnId: 'turn-1',
      promptMessageId: 'message-1',
      allowedToolNames: ['vfs_read', 'vfs_write'],
    })).toEqual({
      type: 'http',
      name: 'kalio',
      url: 'http://127.0.0.1:3316/api/mcp/bridge',
      headers: [
        { name: 'Authorization', value: 'Bearer secret-token' },
        { name: 'x-kalio-session-id', value: 'session-1' },
        { name: 'x-kalio-vfs-session-id', value: 'vfs-1' },
        { name: 'x-kalio-turn-id', value: 'turn-1' },
        { name: 'x-kalio-prompt-message-id', value: 'message-1' },
        { name: 'x-kalio-tool-names', value: 'vfs_read,vfs_write' },
      ],
    });
    expect(kalioMcpBridgeUrl()).toBe('http://127.0.0.1:3316/api/mcp/bridge');
  });
});
