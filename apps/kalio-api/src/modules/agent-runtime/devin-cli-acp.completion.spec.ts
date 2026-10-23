import { describe, expect, it } from 'vitest';
import type { LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import { DevinCliAcpLLMSource } from './devin-cli-acp.llm-source';
import type { DevinAcpPromptInput } from './devin-cli-acp.host';
import { KalioMcpBridgeContextRegistry } from '../../common/kalio-mcp-bridge-context';

describe('Devin ACP completion boundary', () => {
  async function execute(stopReason: 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal', text = '') {
    const host = {
      ensureSession: async () => ({ sessionId: 'acp', cwd: process.cwd(), processEpoch: 'epoch', resumed: false }),
      prompt: async (_id: string, _prompt: string, input: DevinAcpPromptInput) => {
        input.onThought('I will continue reading.');
        if (text) input.onText(text);
        return stopReason;
      },
    };
    const source = new DevinCliAcpLLMSource(
      { get: async () => host } as never,
      { get: async () => ({ filesystem: false, web: false, terminal: false, source: 'default' }) } as never,
      { getToken: async () => null } as never,
      new KalioMcpBridgeContextRegistry(),
    );
    const chunks = [];
    for await (const chunk of source.stream({
      messages: [{ role: 'user', content: 'Complete the task' }], tools: [], sessionId: 'chat', messageId: 'answer',
      executionProfile: { id: 'devin', name: 'Devin', kind: 'devin-cli-acp', model: 'swe-2', approvalMode: 'kalio_strict', enabled: true, capabilitiesVersion: '1', createdAt: 0, updatedAt: 0 },
    } satisfies LLMSourceParams)) chunks.push(chunk);
    return chunks;
  }

  it('does not report a thought-only end_turn as a successful answer', async () => {
    await expect(execute('end_turn')).rejects.toThrow('without a user-visible answer');
  });

  it.each(['max_tokens', 'max_turn_requests', 'refusal'] as const)('does not report %s as completion', async (reason) => {
    await expect(execute(reason, 'Partial output')).rejects.toThrow('did not complete');
  });

  it('retains successful end_turn with an actual answer', async () => {
    expect(await execute('end_turn', 'Build passed')).toContainEqual({ type: 'done' });
  });
});
