import { describe, expect, it } from 'vitest';
import { buildLegacyMcpToolName, buildMcpServerStatusPayload, buildMcpToolPayload } from './mcp-projections';

describe('mcp-projections', () => {
  it('projects MCP tools with canonical and legacy server identifiers', () => {
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
    });
    expect(buildLegacyMcpToolName('toml::docs', 'search')).toBe('mcp_docs_search');
  });

  it('projects MCP server status with both canonical and legacy server identifiers', () => {
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
