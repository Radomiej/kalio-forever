import { describe, expect, it } from 'vitest';
import type { MCPTool } from '@kalio/types';
import { getCanonicalMcpToolServerKey, toolBelongsToServerKey } from './mcpToolServerKey';

describe('mcpToolServerKey', () => {
  it('prefers canonical serverKey over legacy serverId', () => {
    const tool = {
      name: 'mcp_toml::docs_search',
      description: 'search docs',
      serverKey: 'toml::docs',
      serverId: 'sqlite::legacy-docs',
      parameters: {},
      requiresConfirmation: false,
    } satisfies MCPTool;

    expect(getCanonicalMcpToolServerKey(tool)).toBe('toml::docs');
    expect(toolBelongsToServerKey(tool, 'toml::docs')).toBe(true);
    expect(toolBelongsToServerKey(tool, 'sqlite::legacy-docs')).toBe(false);
  });

  it('does not treat legacy serverId-only tools as canonical', () => {
    const tool = {
      name: 'mcp_docs_search',
      description: 'legacy search',
      serverId: 'sqlite::docs',
      parameters: {},
      requiresConfirmation: false,
    };

    expect(getCanonicalMcpToolServerKey(tool)).toBe('');
    expect(toolBelongsToServerKey(tool, 'sqlite::docs')).toBe(false);
  });
});
