import { describe, expect, it } from 'vitest';
import type { ToolMeta } from '@kalio/types';
import { isMcpToolSelected, normalizeMcpAllowList, toLegacyMcpToolName } from './mcpToolAllowList';

describe('mcpToolAllowList', () => {
  it('normalizes legacy MCP allow-list entries to canonical tool names', () => {
    const tools = [
      { name: 'mcp_toml::docs_search' },
      { name: 'mcp_toml::docs_reindex' },
    ] satisfies Pick<ToolMeta, 'name'>[];

    expect(toLegacyMcpToolName('mcp_toml::docs_search')).toBe('mcp_docs_search');
    expect(normalizeMcpAllowList(['mcp_docs_search'], tools)).toEqual(['mcp_toml::docs_search']);
  });

  it('keeps canonical names selected when only the legacy alias is persisted', () => {
    const selected = new Set(['mcp_docs_search']);

    expect(isMcpToolSelected(selected, 'mcp_toml::docs_search')).toBe(true);
    expect(isMcpToolSelected(selected, 'mcp_toml::docs_reindex')).toBe(false);
  });
});
