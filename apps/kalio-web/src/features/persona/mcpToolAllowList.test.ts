import { describe, expect, it } from 'vitest';
import type { ToolMeta } from '@kalio/types';
import { isMcpToolSelected, normalizeMcpAllowList } from './mcpToolAllowList';

describe('mcpToolAllowList', () => {
  it('preserves native tools while normalizing MCP allow-list entries', () => {
    const tools = [
      { name: 'mcp_toml::docs_search' },
      { name: 'mcp_toml::docs_reindex' },
    ] satisfies Pick<ToolMeta, 'name'>[];

    expect(normalizeMcpAllowList(['vfs_read_file', 'mcp_docs_search'], tools)).toEqual([
      'vfs_read_file',
      'mcp_toml::docs_search',
    ]);
  });

  it('drops ambiguous legacy MCP aliases instead of guessing a canonical tool', () => {
    const tools = [
      { name: 'mcp_toml::docs_search' },
      { name: 'mcp_sqlite::docs_search' },
    ] satisfies Pick<ToolMeta, 'name'>[];

    expect(normalizeMcpAllowList(['mcp_docs_search'], tools)).toEqual([]);
  });

  it('only matches canonical MCP allow-list names', () => {
    const selected = new Set(['mcp_docs_search']);

    expect(isMcpToolSelected(selected, 'mcp_toml::docs_search')).toBe(false);
    expect(isMcpToolSelected(selected, 'mcp_toml::docs_reindex')).toBe(false);
  });
});
