import { describe, expect, it } from 'vitest';
import { buildMcpServerStatusPayload, buildMcpToolPayload } from './mcp-projections';

describe('mcp-projections', () => {
  it('projects MCP tools with canonical server identifiers', () => {
    const tool = buildMcpToolPayload('toml::docs', {
      name: 'search',
      description: 'Search docs',
      inputSchema: { type: 'object' },
    });

    expect(tool).toEqual({
      name: 'mcp_toml::docs_search',
      description: 'Search docs',
      parameters: { type: 'object' },
      requiresConfirmation: false,
      serverKey: 'toml::docs',
      serverId: 'toml::docs',
      aliases: ['mcp_search'],
    });
  });

  it('projects MCP server status with canonical server identifiers', () => {
    expect(
      buildMcpServerStatusPayload({
        serverKey: 'sqlite::alpha',
        name: 'Alpha',
        status: 'connected',
        tools: [{ name: 'mcp_sqlite::alpha_read', description: '', parameters: {}, requiresConfirmation: false, serverKey: 'sqlite::alpha', serverId: 'sqlite::alpha' }],
        lastError: 'boom',
      }),
    ).toEqual({
      serverId: 'sqlite::alpha',
      serverKey: 'sqlite::alpha',
      serverName: 'Alpha',
      status: 'connected',
      toolCount: 1,
      lastError: 'boom',
    });
  });
});
