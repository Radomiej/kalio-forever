import { describe, expect, it } from 'vitest';
import { buildMcpServerStatusPayload, buildMcpToolName, buildMcpToolPayload } from './mcp-projections';

describe('mcp-projections', () => {
  it('projects MCP tools with canonical server identifiers', () => {
    const tool = buildMcpToolPayload('toml::docs', {
      name: 'search',
      description: 'Search docs',
      inputSchema: { type: 'object' },
    });

    expect(tool).toMatchObject({
      description: 'Search docs',
      parameters: { type: 'object' },
      requiresConfirmation: false,
      serverKey: 'toml::docs',
      serverId: 'toml::docs',
      aliases: ['mcp_toml::docs_search', 'mcp_search'],
    });
    expect(tool.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('builds stable provider-safe names without sanitization collisions', () => {
    const name = buildMcpToolName('toml::data-analyst', 'data_analyst_run_analysis');

    expect(name).toBe(buildMcpToolName('toml::data-analyst', 'data_analyst_run_analysis'));
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(buildMcpToolName('toml::docs-a', 'search')).not.toBe(
      buildMcpToolName('toml::docs_a', 'search'),
    );
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
