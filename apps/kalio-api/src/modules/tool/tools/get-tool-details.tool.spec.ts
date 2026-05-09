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

function makeRequest(toolNames: unknown, tools?: ToolMeta[]): ToolCallRequest {
  return { callId: 'c1', sessionId: 's1', toolName: 'get_tool_details', args: { tool_names: toolNames }, availableTools: tools };
}

function makeRawRequest(args: Record<string, unknown> = {}, tools?: ToolMeta[]): ToolCallRequest {
  return { callId: 'c1', sessionId: 's1', toolName: 'get_tool_details', args, availableTools: tools };
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

  it('shows "any" as typeHint when parameter has no type or enum', async () => {
    const untypedTool = makeMeta('my_tool', 'A tool.', {
      type: 'object',
      properties: {
        param1: { description: 'No type defined here' },
      },
      required: [],
    });
    const result = await tool.execute(makeRequest(['my_tool'], [untypedTool]));
    expect(result.details[0]).toContain('any');
  });

  it('shows enum values as typeHint when parameter has enum', async () => {
    const enumTool = makeMeta('enum_tool', 'A tool.', {
      type: 'object',
      properties: {
        mode: { enum: ['fast', 'slow', 'medium', 'extra'], description: 'Mode selector' },
      },
      required: ['mode'],
    });
    const result = await tool.execute(makeRequest(['enum_tool'], [enumTool]));
    expect(result.details[0]).toContain('enum(fast|slow|medium)');
  });

  it.each([
    { label: 'tool_names is missing', request: makeRawRequest({}, sampleTools) },
    { label: 'tool_names is null', request: makeRequest(null, sampleTools) },
    { label: 'tool_names is a string', request: makeRequest('vfs_read', sampleTools) },
    { label: 'tool_names contains a blank string', request: makeRequest(['vfs_read', '   '], sampleTools) },
    { label: 'tool_names contains a number', request: makeRequest(['vfs_read', 123], sampleTools) },
    { label: 'tool_names contains an object', request: makeRequest(['vfs_read', { name: 'ghost' }], sampleTools) },
  ])('rejects invalid tool_names when $label (REGRESSION)', async ({ request }) => {
    await expect(tool.execute(request)).rejects.toThrow('INVALID_TOOL_NAMES');
  });
});
