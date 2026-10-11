import { describe, expect, it, vi } from 'vitest';
import type { ExecutionProfile } from '@kalio/types';
import type { InternalLLMChunk } from '../chat/interfaces/llm-chunk.types';
import type { LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import { DevinCliAcpLLMSource } from './devin-cli-acp.llm-source';
import type { DevinAcpPromptInput } from './devin-cli-acp.host';
import type { DevinNativeToolsPolicy } from './devin-native-tools';
import { KalioMcpBridgeContextRegistry } from '../../common/kalio-mcp-bridge-context';

async function collect(stream: AsyncIterable<InternalLLMChunk>): Promise<InternalLLMChunk[]> {
  const chunks: InternalLLMChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('DevinCliAcpLLMSource', () => {
  const nativeToolsPolicy: DevinNativeToolsPolicy = { filesystem: false, web: false, terminal: false, source: 'default' };
  type AuditEvent = { eventName?: string; data?: Record<string, unknown> };

  it.each([
    { tool: true, before: ['Checking output.'], after: ['## Preview', ' ready'], expected: 'Checking output.\n\n## Preview ready' },
    { tool: true, before: ['Checking output.\n\n'], after: ['## Preview'], expected: 'Checking output.\n\n## Preview' },
    { tool: true, before: ['Checking output.\n'], after: ['\n## Preview'], expected: 'Checking output.\n\n## Preview' },
    { tool: true, before: [], after: ['## Preview'], expected: '## Preview' },
    { tool: false, before: ['```ts\nconst ', 'value = '], after: ['1;\n', '```'], expected: '```ts\nconst value = 1;\n```' },
  ])('preserves Markdown boundaries without splitting token chunks: $expected', async ({ tool, before, after, expected }) => {
    const host = {
      ensureSession: async () => ({ sessionId: 'acp', cwd: 'C:\\fixture', processEpoch: 'epoch', resumed: false }),
      prompt: async (_id: string, _text: string, input: DevinAcpPromptInput) => {
        before.forEach(input.onText);
        if (tool) input.onToolActivity?.({ toolCallId: 'output', kind: 'execute', title: 'Read output', status: 'completed' });
        after.forEach((text, index) => {
          input.onText(text);
          if (tool && index === 0) input.onToolActivity?.({ toolCallId: 'output', kind: 'execute', title: 'Read output', status: 'completed' });
        });
        return 'end_turn' as const;
      },
    };
    const source = new DevinCliAcpLLMSource(
      { get: async () => host } as never,
      { get: async () => nativeToolsPolicy } as never,
      { getToken: async () => null } as never,
      new KalioMcpBridgeContextRegistry(),
    );
    const chunks = await collect(source.stream({
      messages: [{ role: 'user', content: 'Read output' }], tools: [], sessionId: 'chat', messageId: 'answer',
      executionProfile: { id: 'devin', name: 'Devin', kind: 'devin-cli-acp', model: 'swe-2', approvalMode: 'kalio_strict', enabled: true, capabilitiesVersion: '1', createdAt: 0, updatedAt: 0 },
    }));
    expect(chunks.filter((chunk) => chunk.type === 'text_delta').map((chunk) => chunk.delta).join('')).toBe(expected);
  });

  it('assigns MCP tools to the user turn rather than the run or assistant message', async () => {
    const contexts = new KalioMcpBridgeContextRegistry();
    let observed: ReturnType<KalioMcpBridgeContextRegistry['get']>;
    const host = {
      ensureSession: async () => ({ sessionId: 'acp-identity', cwd: 'C:\\fixture', processEpoch: 'epoch', resumed: false }),
      prompt: async (_id: string, _text: string, input: DevinAcpPromptInput) => {
        const release = input.onTurnStart?.();
        try {
          observed = contexts.get('chat-identity');
          input.onText('Complete');
          return 'end_turn' as const;
        } finally {
          release?.();
        }
      },
    };
    const source = new DevinCliAcpLLMSource(
      { get: async () => host } as never,
      { get: async () => nativeToolsPolicy } as never,
      { getToken: async () => 'test-token' } as never,
      contexts,
    );
    const params = {
      messages: [{ role: 'user', content: 'Inspect fixture' }], tools: [],
      sessionId: 'chat-identity', messageId: 'assistant-iteration', runId: 'journal-run',
      turnId: 'user-turn', promptMessageId: 'user-prompt',
      executionProfile: {
        id: 'devin-identity', name: 'Devin', kind: 'devin-cli-acp', model: 'swe-2',
        approvalMode: 'kalio_strict', enabled: true, capabilitiesVersion: '1', createdAt: 0, updatedAt: 0,
      },
    } as unknown as LLMSourceParams;
    await collect(source.stream(params));
    expect(observed).toMatchObject({
      sessionId: 'chat-identity', turnId: 'user-turn', promptMessageId: 'user-prompt',
    });
    expect(contexts.get('chat-identity')).toBeUndefined();
  });

  it('binds a new ACP session, streams text/thoughts, and scopes Kalio tools through MCP', async () => {
    const prompt = vi.fn(async (_sessionId: string, text: string, input: { onText: (text: string) => void; onThought: (text: string) => void; onToolActivity?: (activity: { toolCallId: string; kind: string; title: string; status: string }) => void }) => {
      expect(text).toContain('SYSTEM:');
      expect(text).toContain('mcp_call_tool');
      expect(text).toContain('server `kalio-runtime`');
      expect(text).toContain('All provider-native filesystem');
      expect(text).toContain('USER:\nInspect the empty fixture.');
      input.onThought('plan');
      input.onToolActivity?.({ toolCallId: 'tool-1', kind: 'read', title: 'Read fixture', status: 'in_progress' });
      input.onText('answer');
      return 'end_turn' as const;
    });
    const host = {
      ensureSession: vi.fn(async () => ({ sessionId: 'acp-session-1', cwd: 'C:\\fixture', processEpoch: 'epoch-1', resumed: false })),
      supportsHttpMcp: vi.fn(async () => true),
      prompt,
    };
    const registry = { get: vi.fn(async () => host) };
    const bridgeContext = { set: vi.fn(), clear: vi.fn() };
    const audits: AuditEvent[] = [];
    const bound = vi.fn(async () => undefined);
    const source = new DevinCliAcpLLMSource(
      registry as never,
      { get: vi.fn(async () => nativeToolsPolicy) } as never,
      { getToken: vi.fn(async () => 'test-token') } as never,
      bridgeContext as never,
    );
    const profile: ExecutionProfile = {
      id: 'devin-local-glm-5-2',
      name: 'Devin · GLM-5.2',
      kind: 'devin-cli-acp',
      model: 'glm-5-2',
      approvalMode: 'kalio_strict',
      enabled: true,
      capabilitiesVersion: '1',
      createdAt: 0,
      updatedAt: 0,
    };
    const params = {
      messages: [
        { role: 'system', content: 'System policy' },
        { role: 'user', content: 'Inspect the empty fixture.' },
      ],
      tools: [{ name: 'vfs_read_file', description: 'read', parameters: { type: 'object' }, requiresConfirmation: false }],
      providerToolNames: ['Read'],
      sessionId: 'kalio-session',
      messageId: 'message-1',
      executionProfile: profile,
      cwd: 'C:\\fixture',
      onExternalThreadBound: bound,
      onExternalAudit: vi.fn(async (event) => { audits.push(event); }),
    } as unknown as LLMSourceParams;

    await expect(collect(source.stream(params))).resolves.toEqual([
      { type: 'thinking_delta', delta: 'plan' },
      { type: 'text_delta', delta: 'answer' },
      { type: 'done' },
    ]);
    expect(bound).toHaveBeenCalledWith('acp-session-1', { processEpoch: 'epoch-1' });
    expect(prompt).toHaveBeenCalledWith('acp-session-1', expect.stringContaining('Inspect the empty fixture.'), expect.any(Object));
    expect(audits.some((event) => event.eventName === 'devin-cli-acp.tools.omitted')).toBe(true);
    expect(audits.some((event) => event.eventName === 'devin-cli-acp.tool')).toBe(true);
  });

  it('uses the latest user message on an existing external session', async () => {
    let receivedPrompt = '';
    const host = {
      ensureSession: vi.fn(async () => ({ sessionId: 'acp-session-2', cwd: 'C:\\fixture', processEpoch: 'epoch-2', resumed: true })),
      supportsHttpMcp: vi.fn(async () => true),
      prompt: vi.fn(async (_id: string, text: string) => {
        receivedPrompt = text;
        return 'cancelled' as const;
      }),
    };
    const source = new DevinCliAcpLLMSource(
      { get: vi.fn(async () => host) } as never,
      { get: vi.fn(async () => nativeToolsPolicy) } as never,
      { getToken: vi.fn(async () => process.env['KALIO_MCP_BRIDGE_TOKEN'] ?? null) } as never,
      { set: vi.fn(), clear: vi.fn() } as never,
    );
    const profile: ExecutionProfile = {
      id: 'devin-local-swe-1-7', name: 'Devin · SWE-1.7', kind: 'devin-cli-acp', model: 'swe-1-7',
      approvalMode: 'kalio_strict', enabled: true, capabilitiesVersion: '1', createdAt: 0, updatedAt: 0,
    };
    await collect(source.stream({
      messages: [
        { role: 'user', content: 'old' }, { role: 'tool', content: 'obsolete result', toolCallId: 'old-call' },
        { role: 'assistant', content: 'answer' }, { role: 'user', content: 'new' },
        { role: 'tool', content: 'styles.css saved successfully', toolCallId: 'approved-write' },
      ],
      tools: [], sessionId: 'session', messageId: 'message', executionProfile: profile, externalThreadId: 'acp-session-2', cwd: 'C:\\fixture',
    } as unknown as LLMSourceParams));
    expect(receivedPrompt).toContain('USER:\nnew');
    expect(receivedPrompt).toContain('approved-write');
    expect(receivedPrompt).toContain('styles.css saved successfully');
    expect(receivedPrompt).not.toContain('obsolete result');
  });

  it('does not advertise or accept a Kalio MCP bridge when its token is missing', async () => {
    let receivedPrompt = '';
    let decision: string | undefined;
    const audits: AuditEvent[] = [];
    const host = {
      ensureSession: vi.fn(async () => ({ sessionId: 'acp-session-no-bridge', cwd: 'C:\\fixture', processEpoch: 'epoch-no-bridge', resumed: false })),
      supportsHttpMcp: vi.fn(async () => true),
      prompt: vi.fn(async (_id: string, text: string, input: DevinAcpPromptInput) => {
        receivedPrompt = text;
        decision = await input.onPermission({
          sessionId: 'acp-session-no-bridge',
          toolCall: {
            toolCallId: 'functions.mcp_call_tool:1',
            name: 'mcp_call_tool',
            rawInput: { server: 'kalio-runtime', tool: 'fs_list' },
          },
          options: [],
        });
        input.onText('Bridge disabled; tool declined.');
        return 'end_turn' as const;
      }),
    };
    const source = new DevinCliAcpLLMSource(
      { get: vi.fn(async () => host) } as never,
      { get: vi.fn(async () => nativeToolsPolicy) } as never,
      { getToken: vi.fn(async () => null) } as never,
      { set: vi.fn(), clear: vi.fn() } as never,
    );

    await collect(source.stream({
      messages: [{ role: 'user', content: 'Create a site.' }],
      tools: [{ name: 'fs_list', description: 'list files', parameters: { type: 'object' }, requiresConfirmation: false }],
      sessionId: 'session-no-bridge', messageId: 'message-no-bridge',
      turnId: 'turn-no-bridge', promptMessageId: 'prompt-no-bridge', runId: 'run-no-bridge',
      onExternalAudit: async (event: AuditEvent) => { audits.push(event); },
      executionProfile: {
        id: 'devin-local-swe-2-high', name: 'Devin SWE-2 High', kind: 'devin-cli-acp', model: 'swe-2-high',
        approvalMode: 'kalio_strict', enabled: true, capabilitiesVersion: '1', createdAt: 0, updatedAt: 0,
      },
      cwd: 'C:\\fixture',
    } as unknown as LLMSourceParams));

    expect(receivedPrompt).toContain('Kalio MCP bridge is disabled');
    expect(receivedPrompt).not.toContain('server `kalio-runtime`');
    expect(decision).toBe('decline');
    const approval = audits.find((event) => event.eventName === 'devin-cli-acp.native_approval');
    expect(approval?.data).toMatchObject({
      turnId: 'turn-no-bridge', promptMessageId: 'prompt-no-bridge', runId: 'run-no-bridge',
      kalioSessionId: 'session-no-bridge', decisionSource: 'policy', categoryEnabled: false,
    });
  });

  it('accepts the Kalio MCP wrapper without enabling native tools', async () => {
    let decision: string | undefined;
    const audits: AuditEvent[] = [];
    const profile: ExecutionProfile = {
      id: 'devin-local-glm-5-2', name: 'Devin · GLM-5.2', kind: 'devin-cli-acp', model: 'glm-5-2',
      approvalMode: 'kalio_strict', enabled: true, capabilitiesVersion: '1', createdAt: 0, updatedAt: 0,
    };
    const host = {
      ensureSession: vi.fn(async () => ({ sessionId: 'acp-session-mcp', cwd: 'C:\\fixture', processEpoch: 'epoch-mcp', resumed: false })),
      supportsHttpMcp: vi.fn(async () => true),
      prompt: vi.fn(async (_id: string, _text: string, input: DevinAcpPromptInput) => {
        input.onToolActivity?.({
          toolCallId: 'functions.mcp_call_tool:1',
          title: 'Calling fs_list from kalio-runtime',
          rawInput: { server: 'kalio-runtime', tool: 'fs_list' },
          status: 'in_progress',
        });
        input.onToolActivity?.({
          toolCallId: 'functions.mcp_call_tool:1',
          kind: undefined,
          name: undefined,
          title: undefined,
          rawInput: undefined,
          status: 'in_progress',
        });
        const request = {
          sessionId: 'acp-session-mcp',
          toolCall: {
            toolCallId: 'functions.mcp_call_tool:1',
            name: null,
            title: 'Calling fs_list from kalio-runtime',
          },
          options: [{ optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' }],
        } as Parameters<DevinAcpPromptInput['onPermission']>[0];
        decision = await input.onPermission(request);
        const nullInputDecision = await input.onPermission({
          ...request,
          toolCall: { ...request.toolCall, rawInput: null },
        });
        expect(nullInputDecision).toBe('accept');
        const toolArgumentsDecision = await input.onPermission({
          ...request,
          toolCall: { ...request.toolCall, rawInput: { path: 'E:/Projekty/home-site' } },
        });
        expect(toolArgumentsDecision).toBe('accept');
        input.onToolActivity?.({
          toolCallId: 'ordinary-tool-2',
          title: 'Calling mcp_call_tool from kalio-runtime',
          rawInput: { server: 'kalio-runtime', tool: 'fs_list' },
        });
        const titleSpoofDecision = await input.onPermission({
          ...request,
          toolCall: { toolCallId: 'ordinary-tool-2' },
        });
        expect(titleSpoofDecision).toBe('decline');
        input.onText('Permission checks completed.');
        return 'end_turn' as const;
      }),
    };
    const source = new DevinCliAcpLLMSource(
      { get: vi.fn(async () => host) } as never,
      { get: vi.fn(async () => nativeToolsPolicy) } as never,
      { getToken: vi.fn(async () => 'test-token') } as never,
      { set: vi.fn(), clear: vi.fn() } as never,
    );

    await collect(source.stream({
      messages: [{ role: 'user', content: 'Use Kalio.' }],
      tools: [{ name: 'fs_list', description: 'list files', parameters: { type: 'object' }, requiresConfirmation: false }],
      sessionId: 'session-mcp', messageId: 'message-mcp', executionProfile: profile, cwd: 'C:\\fixture',
      onExternalAudit: vi.fn(async (event) => { audits.push(event); }),
    } as unknown as LLMSourceParams));

    expect(decision).toBe('accept');
    const approval = audits.find((event) => event.eventName === 'devin-cli-acp.mcp_approval');
    expect(approval).toBeDefined();
    expect(approval?.data).toMatchObject({ toolName: 'fs_list' });
  });

  it('passes the scoped Kalio stdio bridge to ACP session creation when enabled', async () => {
    process.env['KALIO_MCP_BRIDGE_TOKEN'] = 'test-token';
    process.env['PORT'] = '3316';
    const ensureSession = vi.fn(async () => ({ sessionId: 'acp-session-3', cwd: 'C:\\fixture', processEpoch: 'epoch-3', resumed: false }));
    const host = {
      ensureSession,
      supportsHttpMcp: vi.fn(async () => true),
      prompt: vi.fn(async () => 'cancelled' as const),
    };
    const source = new DevinCliAcpLLMSource(
      { get: vi.fn(async () => host) } as never,
      { get: vi.fn(async () => nativeToolsPolicy) } as never,
      { getToken: vi.fn(async () => process.env['KALIO_MCP_BRIDGE_TOKEN'] ?? null) } as never,
      { set: vi.fn(), clear: vi.fn() } as never,
    );
    await collect(source.stream({
      messages: [{ role: 'user', content: 'bridge test' }],
      tools: [{ name: 'vfs_read', description: 'read', parameters: { type: 'object' }, requiresConfirmation: false }],
      sessionId: 'kalio-session-3',
      messageId: 'message-3',
      executionProfile: {
        id: 'devin-local-glm-5-2', name: 'Devin · GLM-5.2', kind: 'devin-cli-acp', model: 'glm-5-2',
        approvalMode: 'kalio_strict', enabled: true, capabilitiesVersion: '1', createdAt: 0, updatedAt: 0,
      },
      cwd: 'C:\\fixture',
    } as unknown as LLMSourceParams));
    expect(ensureSession).toHaveBeenCalledWith('C:\\fixture', undefined, [{
      name: 'kalio-runtime',
      command: process.execPath,
      args: [expect.stringContaining('kalio-mcp-bridge-stdio.js')],
      env: expect.arrayContaining([
        { name: 'KALIO_MCP_BRIDGE_TOKEN', value: 'test-token' },
        { name: 'KALIO_MCP_BRIDGE_TOOL_NAMES', value: 'vfs_read' },
      ]),
    }]);
    const calls = ensureSession.mock.calls as unknown as Array<[string, string | undefined, Array<{ env: Array<{ name: string }> }>]>;
    const config = calls[0]?.[2]?.[0];
    expect(config.env.map((entry) => entry.name)).not.toEqual(expect.arrayContaining(['KALIO_MCP_BRIDGE_TURN_ID', 'KALIO_MCP_BRIDGE_PROMPT_MESSAGE_ID']));
    delete process.env['KALIO_MCP_BRIDGE_TOKEN'];
    delete process.env['PORT'];
  });

  it('falls back to a stdio bridge proxy when the Devin host lacks HTTP MCP', async () => {
    process.env['KALIO_MCP_BRIDGE_TOKEN'] = 'test-token';
    process.env['PORT'] = '3316';
    const ensureSession = vi.fn(async () => ({ sessionId: 'acp-session-4', cwd: 'C:\\fixture', processEpoch: 'epoch-4', resumed: false }));
    const host = {
      ensureSession,
      supportsHttpMcp: vi.fn(async () => false),
      prompt: vi.fn(async () => 'cancelled' as const),
    };
    const source = new DevinCliAcpLLMSource(
      { get: vi.fn(async () => host) } as never,
      { get: vi.fn(async () => nativeToolsPolicy) } as never,
      { getToken: vi.fn(async () => process.env['KALIO_MCP_BRIDGE_TOKEN'] ?? null) } as never,
      { activate: vi.fn(() => () => undefined) } as never,
    );
    await collect(source.stream({
      messages: [{ role: 'user', content: 'stdio bridge test' }],
      tools: [{ name: 'vfs_read', description: 'read', parameters: { type: 'object' }, requiresConfirmation: false }],
      sessionId: 'kalio-session-4',
      messageId: 'message-4',
      executionProfile: {
        id: 'devin-local-glm-5-2', name: 'Devin · GLM-5.2', kind: 'devin-cli-acp', model: 'glm-5-2',
        approvalMode: 'kalio_strict', enabled: true, capabilitiesVersion: '1', createdAt: 0, updatedAt: 0,
      },
      cwd: 'C:\\fixture',
    } as unknown as LLMSourceParams));
    const servers = (ensureSession.mock.calls[0] as unknown as [string, string | undefined, Array<{ command?: string; args?: string[]; env?: Array<{ name: string; value: string }> }>] | undefined)?.[2] ?? [];
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ name: 'kalio-runtime', command: process.execPath });
    expect(servers[0]?.args?.[0]).toContain('kalio-mcp-bridge-stdio.js');
    expect(servers[0]?.env).toEqual(expect.arrayContaining([
      { name: 'KALIO_MCP_BRIDGE_URL', value: 'http://127.0.0.1:3316/api/mcp/bridge' },
      { name: 'KALIO_MCP_BRIDGE_TOKEN', value: 'test-token' },
      { name: 'KALIO_MCP_BRIDGE_SESSION_ID', value: 'kalio-session-4' },
      { name: 'KALIO_MCP_BRIDGE_TOOL_NAMES', value: 'vfs_read' },
    ]));
    delete process.env['KALIO_MCP_BRIDGE_TOKEN'];
    delete process.env['PORT'];
  });
});
