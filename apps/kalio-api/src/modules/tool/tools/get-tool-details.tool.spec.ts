import { describe, it, expect } from 'vitest';
import { GetToolDetailsTool } from './get-tool-details.tool';
import type { ToolCallRequest, ToolMeta } from '@kalio/types';

function makeMeta(name: string, description: string, params?: Record<string, unknown>): ToolMeta {
  return {
    name,
    description,
    parameters: params ?? {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the file' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['filePath'],
    },
    requiresConfirmation: false,
  };
}

function makeRequest(toolNames: string[], tools?: ToolMeta[]): ToolCallRequest {
  return { callId: 'c1', sessionId: 's1', toolName: 'get_tool_details', args: { tool_names: toolNames }, availableTools: tools };
}

describe('GetToolDetailsTool', () => {
  const tool = new GetToolDetailsTool();

  const sampleTools: ToolMeta[] = [
    makeMeta('vfs_write', 'Write content to a file.'),
    makeMeta('vfs_read', 'Read content from a file.', {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to read' },
      },
      required: ['filePath'],
    }),
  ];

  it('returns detail block for a known tool', async () => {
    const result = await tool.execute(makeRequest(['vfs_write'], sampleTools));

    expect(result.errors).toHaveLength(0);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toContain('### vfs_write');
    expect(result.details[0]).toContain('Write content to a file.');
    expect(result.details[0]).toContain('*filePath');  // required param
  });

  it('marks optional params without asterisk', async () => {
    const result = await tool.execute(makeRequest(['vfs_write'], sampleTools));

    expect(result.details[0]).toContain('*filePath');  // required
    // content is not required → no asterisk
    const lines = result.details[0].split('\n');
    const contentLine = lines.find(l => l.includes('content'));
    expect(contentLine).toBeDefined();
    expect(contentLine!.trimStart().startsWith('*')).toBe(false);
  });

  it('returns error entry for unknown tool name', async () => {
    const result = await tool.execute(makeRequest(['nonexistent'], sampleTools));

    expect(result.details).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('nonexistent');
  });

  it('handles mix of known and unknown names', async () => {
    const result = await tool.execute(makeRequest(['vfs_read', 'ghost_tool'], sampleTools));

    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toContain('### vfs_read');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('ghost_tool');
  });

  it('handles missing availableTools gracefully', async () => {
    const result = await tool.execute(makeRequest(['vfs_write']));

    expect(result.details).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('vfs_write');
  });

  it('handles tool with no properties', async () => {
    const noParamTool = makeMeta('ping', 'Simple ping.', { type: 'object', properties: {}, required: [] });
    const result = await tool.execute(makeRequest(['ping'], [noParamTool]));

    expect(result.errors).toHaveLength(0);
    expect(result.details[0]).toContain('### ping');
    expect(result.details[0]).toContain('(none)');
  });
});
