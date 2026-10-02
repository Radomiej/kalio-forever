import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MCPService } from './mcp.service';
import type { ServerHandle } from './mcp-runtime.utils';

const clientConnect = vi.hoisted(() => vi.fn());
const clientListTools = vi.hoisted(() => vi.fn());
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: clientConnect,
    listTools: clientListTools,
    close: vi.fn(),
  })),
}));

import { MCPService as MCPServiceClass } from './mcp.service';

describe('MCP stdio command audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientConnect.mockResolvedValue(undefined);
    clientListTools.mockResolvedValue({ tools: [] });
  });

  it('records a configured cmd.exe stdio launch before connecting the transport', async () => {
    const audit = { recordInvocation: vi.fn().mockResolvedValue(undefined) };
    const service = Reflect.construct(MCPServiceClass, [{ db: {} }, undefined, audit]) as MCPService;
    vi.spyOn(service as unknown as { persistStatus(handle: ServerHandle): Promise<void> }, 'persistStatus')
      .mockResolvedValue(undefined);
    const handle: ServerHandle = {
      serverKey: 'toml::test',
      id: 'test',
      name: 'test',
      store: 'toml',
      originSource: 'toml',
      transport: 'stdio',
      command: 'cmd.exe',
      args: ['/c', 'worker'],
      client: null as never,
      rawTransport: null,
      status: 'disconnected',
      tools: [],
      restartCount: 0,
      createdAt: 0,
      enabled: true,
      signature: 'test-signature',
    };
    const connectHandle = (service as unknown as {
      connectHandle(input: ServerHandle): Promise<void>;
    }).connectHandle.bind(service);

    await connectHandle(handle);

    expect(audit.recordInvocation).toHaveBeenCalledExactlyOnceWith({
      command: 'cmd.exe',
      source: 'mcp.stdio.connect',
      launcher: 'stdio-transport',
    });
    expect(clientConnect).toHaveBeenCalledOnce();
  });
});
