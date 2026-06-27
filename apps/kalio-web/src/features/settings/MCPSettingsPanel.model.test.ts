import { describe, expect, it } from 'vitest';
import type { SettingsMCPServer } from './MCPSettingsPanel.model';
import { normalizeSettingsServer, normalizeSettingsServers } from './MCPSettingsPanel.model';

const BASE_SERVER: SettingsMCPServer = {
  id: 'sqlite-row-github',
  name: 'GitHub MCP',
  transport: 'http',
  url: 'https://mcp.github.com/sse',
  status: 'connected',
  toolCount: 5,
  createdAt: 1704067200000,
  serverKey: 'sqlite::github',
  store: 'sqlite',
  originSource: 'manual',
  effectiveState: 'active',
  conflictGroup: 'github-signature',
};

describe('normalizeSettingsServer', () => {
  it('uses serverKey for row keys instead of raw row ids', () => {
    const normalized = normalizeSettingsServer(BASE_SERVER);

    expect(normalized.serverKey).toBe('sqlite::github');
    expect(normalized.rowKey).toBe('sqlite::github:sqlite');
    expect(normalized.testIdSuffix).toBe('sqlite-github-sqlite');
  });

  it('sorts normalized rows by canonical serverKey and store before raw id', () => {
    const rows = normalizeSettingsServers([
      {
        ...BASE_SERVER,
        id: 'sqlite-row-b',
        serverKey: 'sqlite::beta',
        conflictGroup: null,
      },
      {
        ...BASE_SERVER,
        id: 'toml-row-a',
        serverKey: 'toml::alpha',
        store: 'toml',
        originSource: 'toml',
        effectiveState: 'active',
        conflictGroup: null,
      },
      {
        ...BASE_SERVER,
        id: 'sqlite-row-a',
        serverKey: 'sqlite::alpha',
        conflictGroup: null,
      },
    ]);

    expect(rows.map((row) => row.serverKey)).toEqual(['sqlite::alpha', 'sqlite::beta', 'toml::alpha']);
  });
});
