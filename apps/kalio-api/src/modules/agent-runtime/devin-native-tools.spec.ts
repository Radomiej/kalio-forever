import { describe, expect, it } from 'vitest';
import { classifyDevinNativeTool, isKalioMcpToolCall } from './devin-native-tools';

describe('Devin native tool classification', () => {
  it('maps ACP tool kinds to the matching settings category', () => {
    expect(classifyDevinNativeTool({ kind: 'read', title: 'Read file' })).toBe('filesystem');
    expect(classifyDevinNativeTool({ kind: 'execute', title: 'Run command' })).toBe('terminal');
    expect(classifyDevinNativeTool({ kind: 'fetch', title: 'Fetch URL' })).toBe('web');
  });

  it('uses labels to distinguish web search from filesystem search', () => {
    expect(classifyDevinNativeTool({ kind: 'search', title: 'Search workspace files' })).toBe('filesystem');
    expect(classifyDevinNativeTool({ kind: 'search', title: 'Search the web' })).toBe('web');
  });

  it('fails closed for an unclassified tool', () => {
    expect(classifyDevinNativeTool({ kind: 'other', title: 'Unknown operation' })).toBeUndefined();
  });

  it('recognizes only the Kalio MCP wrapper as a bridge call', () => {
    expect(isKalioMcpToolCall({
      name: 'mcp_call_tool',
      title: 'Calling fs_list from kalio',
      kind: 'execute',
      rawInput: { server: 'kalio', tool: 'fs_list' },
    })).toBe(true);
    expect(isKalioMcpToolCall({
      name: 'mcp_call_tool',
      title: 'Calling list_issues from github',
      rawInput: { server: 'github', tool: 'list_issues' },
    })).toBe(false);
    expect(isKalioMcpToolCall({
      title: 'Calling fs_list from kalio',
      kind: 'execute',
      toolCallId: 'functions.mcp_call_tool:1',
    })).toBe(true);
    expect(isKalioMcpToolCall({
      name: 'mcp_call_tool',
      title: 'Calling fs_list from kalio-runtime',
      rawInput: { server: 'kalio-runtime', tool: 'fs_list' },
    }, 'kalio-runtime')).toBe(true);
  });
});
