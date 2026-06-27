import { describe, expect, it } from 'vitest';
import { hasLegacyMcpAlias, resolveToolAlias, toLegacyMcpToolName } from '../mcp-tool-allow-list';

describe('mcp-tool-allow-list', () => {
  it('maps canonical MCP tool names to legacy aliases', () => {
    expect(toLegacyMcpToolName('mcp_toml::docs_search')).toBe('mcp_docs_search');
  });

  it('prefers canonical MCP tool names when resolving legacy aliases', () => {
    const available = new Set(['mcp_toml::docs_search']);
    expect(resolveToolAlias('mcp_docs_search', available)).toBe('mcp_toml::docs_search');
  });

  it('accepts legacy allow-list aliases for canonical MCP tools', () => {
    const allowed = new Set(['mcp_docs_search']);
    expect(hasLegacyMcpAlias('mcp_toml::docs_search', allowed)).toBe(true);
  });
});
