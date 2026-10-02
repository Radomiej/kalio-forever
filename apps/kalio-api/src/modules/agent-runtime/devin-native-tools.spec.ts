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

  it('auto-approves only structured Kalio MCP wrappers for allowlisted tools', () => {
    const server = 'kalio-runtime';
    const allowedTools = ['fs_list'];
    const structuredCall = {
      name: 'mcp_call_tool',
      rawInput: { server, tool: 'fs_list' },
    };

    expect(isKalioMcpToolCall(structuredCall, server, allowedTools)).toBe(true);
    expect(isKalioMcpToolCall({
      toolCallId: 'functions.mcp_call_tool:1',
      rawInput: { server, tool: 'fs_list' },
    }, server, allowedTools)).toBe(false);
    expect(isKalioMcpToolCall({
      toolCallId: 'functions.mcp_call_tool:1',
      name: 'native_shell',
      rawInput: { server, tool: 'fs_list' },
    }, server, allowedTools)).toBe(false);
    expect(isKalioMcpToolCall({
      toolCallId: 'ordinary-tool-1',
      name: 'fs_list',
      title: 'Calling mcp_call_tool from kalio-runtime',
      rawInput: { server, tool: 'fs_list' },
    }, server, allowedTools)).toBe(false);
    expect(isKalioMcpToolCall({
      name: 'mcp_call_tool',
      title: 'Calling fs_list from kalio-runtime',
    }, server, allowedTools)).toBe(false);
    expect(isKalioMcpToolCall({ name: 'mcp_call_tool', rawInput: { tool: 'fs_list' } }, server, allowedTools)).toBe(false);
    expect(isKalioMcpToolCall({ name: 'mcp_call_tool', rawInput: { server, tool: ' fs_list ' } }, server, allowedTools)).toBe(false);
    expect(isKalioMcpToolCall({ name: 'mcp_call_tool', rawInput: { server: 'github', tool: 'fs_list' } }, server, allowedTools)).toBe(false);
    expect(isKalioMcpToolCall({ name: 'mcp_call_tool', rawInput: { server: ' KALIO-RUNTIME ', tool: 'fs_list' } }, server, allowedTools)).toBe(false);
    expect(isKalioMcpToolCall({ name: 'mcp_call_tool', rawInput: { server, tool: 'fs_write' } }, server, allowedTools)).toBe(false);
    expect(isKalioMcpToolCall({ name: 'fs_list', rawInput: { server, tool: 'fs_list' } }, server, allowedTools)).toBe(false);
    expect(isKalioMcpToolCall(structuredCall, server, [])).toBe(false);
  });

  it('recognizes a structured allowlisted Kalio MCP call when ACP omits the wrapper name', () => {
    expect(isKalioMcpToolCall({
      title: 'Calling fs_list from kalio-runtime',
      rawInput: { server: 'kalio-runtime', tool: 'fs_list' },
    }, 'kalio-runtime', ['fs_list'])).toBe(true);
  });

  it('recognizes exact allowlisted titles while treating raw input as tool arguments', () => {
    const server = 'kalio-runtime';
    const allowedTools = ['fs_list'];

    expect(isKalioMcpToolCall({
      name: null,
      title: 'Calling fs_list from kalio-runtime',
    }, server, allowedTools)).toBe(true);
    expect(isKalioMcpToolCall({
      name: null,
      title: 'Calling fs_list from kalio-runtime',
      rawInput: { path: 'E:/Projekty/home-site' },
    }, server, allowedTools)).toBe(true);
    expect(isKalioMcpToolCall({
      name: null,
      title: 'Calling fs_write from kalio-runtime',
    }, server, allowedTools)).toBe(false);
    expect(isKalioMcpToolCall({
      name: null,
      title: 'Calling fs_list from github',
    }, server, allowedTools)).toBe(false);
    expect(isKalioMcpToolCall({
      name: null,
      title: 'Calling fs_list from kalio-runtime',
      rawInput: { server: 'github', path: 'E:/Projekty/home-site' },
    }, server, allowedTools)).toBe(false);
    expect(isKalioMcpToolCall({
      name: 'native_shell',
      title: 'Calling fs_list from kalio-runtime',
    }, server, allowedTools)).toBe(false);
  });
});
