import { describe, expect, it, vi } from 'vitest';
import type { ExecutionProfile, ToolMeta, ToolResult } from '@kalio/types';
import { ClaudeAgentSdkLLMSource } from './claude-agent-sdk.llm-source';

const sdk = vi.hoisted(() => ({
  query: vi.fn(),
  createSdkMcpServer: vi.fn((options: unknown) => options),
  tool: vi.fn((name: string, description: string, inputSchema: unknown, handler: unknown) => ({ name, description, inputSchema, handler })),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => sdk);

const profile: ExecutionProfile = {
  id: 'claude-local',
  name: 'Claude local',
  kind: 'claude-agent-sdk',
  model: 'claude-sonnet-4-6',
  approvalMode: 'kalio_strict',
  enabled: true,
  capabilitiesVersion: '1',
  createdAt: 1,
  updatedAt: 1,
};

const toolMeta: ToolMeta = {
  name: 'vfs_read',
  description: 'Read a file from the current VFS workspace.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  requiresConfirmation: false,
};

function messages() {
  return [
    { role: 'system' as const, content: 'Follow Kalio policy.' },
    { role: 'user' as const, content: 'Read the README.' },
  ];
}

describe('ClaudeAgentSdkLLMSource', () => {
  it('maps SDK streaming messages and binds the external session without loading user settings', async () => {
    sdk.query.mockReturnValue((async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'claude-session-1', claude_code_version: '2.1.220', model: 'claude-sonnet-4-6' };
      yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello from Claude.' } } };
      yield { type: 'result', subtype: 'success', result: 'Hello from Claude.', errors: [] };
    })());
    const bound = vi.fn(async () => undefined);
    const chunks = await collect(new ClaudeAgentSdkLLMSource().stream({
      messages: messages() as never,
      tools: [],
      sessionId: 'kalio-session',
      messageId: 'message-1',
      executionProfile: profile,
      onExternalThreadBound: bound,
    }));

    expect(chunks).toEqual([
      { type: 'text_delta', delta: 'Hello from Claude.' },
      { type: 'done' },
    ]);
    expect(sdk.query).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'USER:\nRead the README.',
      options: expect.objectContaining({
        settingSources: [],
        tools: [],
        strictMcpConfig: true,
        systemPrompt: expect.stringContaining('Claude built-in tools and external MCP access are disabled'),
      }),
    }));
    expect(bound).toHaveBeenCalledWith('claude-session-1', { processEpoch: '2.1.220:claude-session-1' });
  });

  it('routes an in-process Kalio tool call through the existing result channel', async () => {
    let resultHandler: ((callId: string, result: ToolResult) => void) | undefined;
    sdk.query.mockReturnValue((async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'claude-session-2', claude_code_version: '2.1.220', model: 'claude-sonnet-4-6' };
      const definition = sdk.tool.mock.results[0]?.value as { handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown> };
      const toolResult = await definition.handler({ path: 'README.md' }, {});
      expect(toolResult).toEqual(expect.objectContaining({ content: [expect.objectContaining({ type: 'text' })] }));
      yield { type: 'result', subtype: 'success', result: 'Done.', errors: [] };
    })());

    const iterator = new ClaudeAgentSdkLLMSource().stream({
      messages: messages() as never,
      tools: [toolMeta],
      sessionId: 'kalio-session',
      messageId: 'message-2',
      executionProfile: profile,
      toolResultChannel: { setHandler: (handler) => { resultHandler = handler; } },
    })[Symbol.asyncIterator]();

    const toolCall = await iterator.next();
    expect(toolCall.value).toMatchObject({ type: 'tool_call', name: 'vfs_read', args: { path: 'README.md' } });
    const callId = (toolCall.value as { callId: string }).callId;
    resultHandler?.(callId, { callId, status: 'success', data: { content: 'read' } });

    const remaining = await collectIterator(iterator);
    expect(remaining).toContainEqual({ type: 'done' });
    expect(sdk.createSdkMcpServer).toHaveBeenCalledWith(expect.objectContaining({ name: 'kalio', alwaysLoad: true }));
  });

  it('keeps external/child tools out while opting into a persona-owned Claude tool list', async () => {
    sdk.query.mockClear();
    sdk.tool.mockClear();
    sdk.createSdkMcpServer.mockClear();
    sdk.query.mockReturnValue((async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'claude-session-3', claude_code_version: '2.1.240', model: 'claude-sonnet-5' };
      yield { type: 'result', subtype: 'success', result: 'Scoped.', errors: [] };
    })());

    const externalMcpTool: ToolMeta = {
      name: 'external_search',
      description: 'External MCP search.',
      parameters: { type: 'object', properties: {} },
      requiresConfirmation: false,
      serverKey: 'external-search',
    };
    const childTool: ToolMeta = {
      name: 'run_cli_agent',
      description: 'Run a separate CLI child.',
      parameters: { type: 'object', properties: {} },
      requiresConfirmation: true,
      domain: 'cli_agent',
    };
    const confirmationTool: ToolMeta = {
      name: 'vfs_write',
      description: 'Write a file in the current VFS workspace.',
      parameters: { type: 'object', properties: {} },
      requiresConfirmation: true,
    };
    const configuredWebTool: ToolMeta = {
      name: 'web_search',
      description: 'Search the web through Kalio.',
      parameters: { type: 'object', properties: {} },
      requiresConfirmation: false,
    };

    const approval = vi.fn(async () => 'accept' as const);
    await collect(new ClaudeAgentSdkLLMSource().stream({
      messages: messages() as never,
      tools: [toolMeta, externalMcpTool, childTool, confirmationTool, configuredWebTool],
      sessionId: 'kalio-session',
      messageId: 'message-3',
      executionProfile: { ...profile, model: 'claude-sonnet-5' },
      providerToolNames: ['Read', 'WebSearch', 'Task', 'mcp__external'],
      onNativeApprovalRequested: approval,
    }));

    const serverOptions = sdk.createSdkMcpServer.mock.calls[0]?.[0] as { tools: Array<{ name: string }> };
    expect(serverOptions.tools.map((tool) => tool.name)).toEqual(['vfs_read', 'vfs_write', 'web_search']);
    expect(sdk.query).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        tools: ['Read', 'WebSearch'],
      }),
    }));
    const queryOptions = (sdk.query.mock.calls[0]?.[0] as { options: Record<string, unknown> }).options;
    expect(queryOptions).not.toHaveProperty('allowedTools');
    expect(queryOptions['canUseTool']).toEqual(expect.any(Function));
    const canUseTool = queryOptions['canUseTool'] as (
      toolName: string,
      input: unknown,
      options: { toolUseID: string; title?: string },
    ) => Promise<{ behavior: string; toolUseID: string; message?: string }>;
    await expect(canUseTool('mcp__kalio__vfs_read', {}, { toolUseID: 'safe-1' })).resolves.toEqual({
      behavior: 'allow',
      toolUseID: 'safe-1',
    });
    await expect(canUseTool('mcp__kalio__vfs_write', { path: 'README.md' }, { toolUseID: 'write-1', title: 'Write file' })).resolves.toEqual({
      behavior: 'allow',
      toolUseID: 'write-1',
    });
    await expect(canUseTool('Read', { file_path: 'README.md' }, { toolUseID: 'read-1', title: 'Read file' })).resolves.toEqual({
      behavior: 'allow',
      toolUseID: 'read-1',
    });
    expect(approval).toHaveBeenCalledWith(expect.objectContaining({
      method: 'claude.native_approval',
      params: expect.objectContaining({ toolName: 'mcp__kalio__vfs_write', toolUseId: 'write-1' }),
    }));
    expect(approval).toHaveBeenCalledWith(expect.objectContaining({
      method: 'claude.native_approval',
      params: expect.objectContaining({ toolName: 'Read', toolUseId: 'read-1' }),
    }));
  });
});

async function collect(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

async function collectIterator(iterator: AsyncIterator<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  while (true) {
    const next = await iterator.next();
    if (next.done) return values;
    values.push(next.value);
  }
}
