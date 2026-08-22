import { describe, expect, it, vi } from 'vitest';
import type { ExecutionProfile } from '@kalio/types';
import type { InternalLLMChunk } from '../chat/interfaces/llm-chunk.types';
import type { LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import { DevinCliAcpLLMSource } from './devin-cli-acp.llm-source';

async function collect(stream: AsyncIterable<InternalLLMChunk>): Promise<InternalLLMChunk[]> {
  const chunks: InternalLLMChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('DevinCliAcpLLMSource', () => {
  it('binds a new ACP session, streams text/thoughts, and omits Kalio tool forwarding', async () => {
    const prompt = vi.fn(async (_sessionId: string, text: string, input: { onText: (text: string) => void; onThought: (text: string) => void }) => {
      expect(text).toContain('SYSTEM:');
      expect(text).toContain('USER:\nInspect the empty fixture.');
      input.onThought('plan');
      input.onText('answer');
      return 'end_turn' as const;
    });
    const host = {
      ensureSession: vi.fn(async () => ({ sessionId: 'acp-session-1', cwd: 'C:\\fixture', processEpoch: 'epoch-1', resumed: false })),
      prompt,
    };
    const registry = { get: vi.fn(async () => host) };
    const audits: Array<{ eventName?: string }> = [];
    const bound = vi.fn(async () => undefined);
    const source = new DevinCliAcpLLMSource(registry as never);
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
  });

  it('uses the latest user message on an existing external session', async () => {
    let receivedPrompt = '';
    const host = {
      ensureSession: vi.fn(async () => ({ sessionId: 'acp-session-2', cwd: 'C:\\fixture', processEpoch: 'epoch-2', resumed: true })),
      prompt: vi.fn(async (_id: string, text: string) => {
        receivedPrompt = text;
        return 'cancelled' as const;
      }),
    };
    const source = new DevinCliAcpLLMSource({ get: vi.fn(async () => host) } as never);
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
});
