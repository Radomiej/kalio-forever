import { describe, it, expect } from 'vitest';
import { ListToolsTool } from './list-tools.tool';
import type { ToolCallRequest, ToolMeta } from '@kalio/types';

function makeMeta(name: string, description: string): ToolMeta {
  return { name, description, parameters: { type: 'object', properties: {}, required: [] }, requiresConfirmation: false };
}

function makeRequest(args: Record<string, unknown> = {}, tools?: ToolMeta[]): ToolCallRequest {
  return { callId: 'c1', sessionId: 's1', toolName: 'list_tools', args, availableTools: tools };
}

describe('ListToolsTool', () => {
  const tool = new ListToolsTool();

  const sampleTools: ToolMeta[] = [
    makeMeta('vfs_write', 'Write content to a file in the conversation virtual filesystem.'),
    makeMeta('list_tools', 'Returns a compact list of all available tools.'),
    makeMeta('memory_search', 'Search the agent memory for relevant entries.'),
    makeMeta('vfs_read', 'Read content from a file in the conversation virtual filesystem.'),
  ];

  it('returns sorted list and excludes list_tools itself', async () => {
    const result = await tool.execute(makeRequest({}, sampleTools));

    expect(result.count).toBe(3);
    const names = result.tools.map(line => line.split(':')[0].replace('- ', ''));
    expect(names).toEqual(['memory_search', 'vfs_read', 'vfs_write']);
  });

  it('applies case-insensitive filter', async () => {
    const result = await tool.execute(makeRequest({ filter: 'vfs' }, sampleTools));

    expect(result.count).toBe(2);
    expect(result.tools.every(line => line.toLowerCase().includes('vfs'))).toBe(true);
  });

  it('returns empty list when filter matches nothing', async () => {
    const result = await tool.execute(makeRequest({ filter: 'nonexistent' }, sampleTools));

    expect(result.count).toBe(0);
    expect(result.tools).toEqual([]);
  });

  it('handles missing availableTools gracefully', async () => {
    const result = await tool.execute(makeRequest({}));

    expect(result.count).toBe(0);
    expect(result.tools).toEqual([]);
  });

  it('truncates descriptions longer than 80 characters', async () => {
    const longDesc = 'A'.repeat(100);
    const result = await tool.execute(makeRequest({}, [makeMeta('some_tool', longDesc)]));

    const line = result.tools[0];
    expect(line).toContain('some_tool');
    // description portion ends with ellipsis
    expect(line.endsWith('…')).toBe(true);
    // total description portion is ≤80 chars
    const descPart = line.slice(line.indexOf(':') + 2);
    expect(descPart.length).toBeLessThanOrEqual(80);
  });
});
