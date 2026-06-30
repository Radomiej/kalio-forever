import { describe, expect, it } from 'vitest';
import { resolveToolAlias } from '../mcp-tool-allow-list';

describe('mcp-tool-allow-list', () => {
  it('passes through canonical MCP tool names unchanged', () => {
    const available = [{ name: 'mcp_toml::docs_search' }];
    expect(resolveToolAlias('mcp_toml::docs_search', available)).toBe('mcp_toml::docs_search');
  });

  it('maps explicit legacy MCP aliases to canonical names', () => {
    const available = [{ name: 'mcp_toml::docs_search', aliases: ['mcp_docs_search'] }];
    expect(resolveToolAlias('mcp_docs_search', available)).toBe('mcp_toml::docs_search');
  });

  it('does not infer legacy MCP aliases from canonical names without alias metadata', () => {
    const available = [{ name: 'mcp_toml::docs_search' }];
    expect(resolveToolAlias('mcp_docs_search', available)).toBeNull();
  });

  it('rejects ambiguous explicit legacy MCP aliases', () => {
    const available = [
      { name: 'mcp_toml::docs_search', aliases: ['mcp_docs_search'] },
      { name: 'mcp_sqlite::docs_search', aliases: ['mcp_docs_search'] },
    ];
    expect(resolveToolAlias('mcp_docs_search', available)).toBeNull();
  });
});
