import { describe, expect, it, vi } from 'vitest';
import type { ExecutionProfile } from '@kalio/types';
import type { InternalLLMChunk } from '../chat/interfaces/llm-chunk.types';
import type { LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import { DevinCliAcpLLMSource } from './devin-cli-acp.llm-source';
import type { DevinNativeToolsPolicy } from './devin-native-tools';

async function collect(stream: AsyncIterable<InternalLLMChunk>): Promise<InternalLLMChunk[]> {
  const chunks: InternalLLMChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('DevinCliAcpLLMSource', () => {
  const nativeToolsPolicy: DevinNativeToolsPolicy = { filesystem: false, web: false, terminal: false, source: 'default' };

  it('binds a new ACP session, streams text/thoughts, and omits Kalio tool forwarding', async () => {
    const prompt = vi.fn(async (_sessionId: string, text: string, input: { onText: (text: string) => void; onThought: (text: string) => void; onToolActivity?: (activity: { toolCallId: string; kind: string; title: string; status: string }) => void }) => {
      expect(text).toContain('SYSTEM:');
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
    const audits: Array<{ eventName?: string }> = [];
    const bound = vi.fn(async () => undefined);
    const source = new DevinCliAcpLLMSource(
      registry as never,
      { get: vi.fn(async () => nativeToolsPolicy) } as never,
      { getToken: vi.fn(async () => process.env['KALIO_MCP_BRIDGE_TOKEN'] ?? null) } as never,
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
      messages: [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'answer' }, { role: 'user', content: 'new' }],
      tools: [], sessionId: 'session', messageId: 'message', executionProfile: profile, externalThreadId: 'acp-session-2', cwd: 'C:\\fixture',
    } as unknown as LLMSourceParams));
    expect(receivedPrompt).toBe('new');
  });

  it('passes the scoped Kalio MCP server to ACP session creation when enabled', async () => {
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
      type: 'http',
      name: 'kalio',
      url: 'http://127.0.0.1:3316/api/mcp/bridge',
      headers: expect.arrayContaining([
        { name: 'Authorization', value: 'Bearer test-token' },
        { name: 'x-kalio-tool-names', value: 'vfs_read' },
      ]),
    }]);
    const calls = ensureSession.mock.calls as unknown as Array<[string, string | undefined, Array<{ headers: Array<{ name: string }> }>]>;
    const config = calls[0]?.[2]?.[0];
    expect(config.headers.map((header) => header.name)).not.toEqual(expect.arrayContaining(['x-kalio-turn-id', 'x-kalio-prompt-message-id']));
    delete process.env['KALIO_MCP_BRIDGE_TOKEN'];
    delete process.env['PORT'];
  });
});
