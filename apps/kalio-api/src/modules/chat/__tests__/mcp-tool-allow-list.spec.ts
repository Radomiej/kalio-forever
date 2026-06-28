import { describe, expect, it } from 'vitest';
import { resolveToolAlias } from '../mcp-tool-allow-list';

describe('mcp-tool-allow-list', () => {
  it('passes through canonical MCP tool names unchanged', () => {
    const available = new Set(['mcp_toml::docs_search']);
    expect(resolveToolAlias('mcp_toml::docs_search', available)).toBe('mcp_toml::docs_search');
  });

  it('maps unique legacy MCP aliases to canonical names', () => {
    const available = new Set(['mcp_toml::docs_search']);
    expect(resolveToolAlias('mcp_docs_search', available)).toBe('mcp_toml::docs_search');
  });

  it('rejects ambiguous legacy MCP aliases', () => {
    const available = new Set(['mcp_toml::docs_search', 'mcp_sqlite::docs_search']);
    expect(resolveToolAlias('mcp_docs_search', available)).toBeNull();
  });
});
