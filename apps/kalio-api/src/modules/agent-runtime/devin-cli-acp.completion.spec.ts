import { describe, expect, it } from 'vitest';
import type { LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import { DevinCliAcpLLMSource } from './devin-cli-acp.llm-source';
import type { DevinAcpPromptInput } from './devin-cli-acp.host';
import { KalioMcpBridgeContextRegistry } from '../../common/kalio-mcp-bridge-context';
import { DevinAcpIdleTimeoutError } from './devin-cli-acp.execution-guard';
import { DevinModelBindingError } from './devin-cli-acp.model-selection';

describe('Devin ACP completion boundary', () => {
  async function execute(stopReason: 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal', text = '', followUpText = '', lost: string[] = []) {
    let calls = 0;
    const host = {
      ensureSession: async () => ({ sessionId: 'acp', cwd: process.cwd(), processEpoch: 'epoch', resumed: false }),
      prompt: async (_id: string, _prompt: string, input: DevinAcpPromptInput) => {
        calls += 1;
        if (calls > 1) {
          if (followUpText) input.onText(followUpText);
          return 'end_turn';
        }
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
      onExternalRuntimeLost: () => lost.push('lost'),
      executionProfile: { id: 'devin', name: 'Devin', kind: 'devin-cli-acp', model: 'swe-2', approvalMode: 'kalio_strict', enabled: true, capabilitiesVersion: '1', createdAt: 0, updatedAt: 0 },
    } satisfies LLMSourceParams)) chunks.push(chunk);
    return Object.assign(chunks, { calls });
  }

  it('asks once for a written summary after a thought-only end_turn and keeps the answer', async () => {
    const lost: string[] = [];
    const chunks = await execute('end_turn', '', 'Summary: done', lost);
    expect(chunks).toContainEqual({ type: 'text_delta', delta: 'Summary: done' });
    expect(chunks).toContainEqual({ type: 'done' });
    expect(chunks.calls).toBe(2);
    expect(lost).toEqual([]);
  });

  it('completes with a notice, not a lost runtime, when Devin stays silent after the follow-up', async () => {
    const lost: string[] = [];
    const chunks = await execute('end_turn', '', '', lost);
    expect(chunks.some(chunk => chunk.type === 'text_delta' && chunk.delta.includes('returned no written answer'))).toBe(true);
    expect(chunks).toContainEqual({ type: 'done' });
    expect(chunks.calls).toBe(2);
    expect(lost).toEqual([]);
  });

  it.each(['max_tokens', 'max_turn_requests', 'refusal'] as const)('does not report %s as completion', async (reason) => {
    await expect(execute(reason, 'Partial output')).rejects.toThrow('did not complete');
  });

  it('reports an idle timeout as LLM_TIMEOUT without a lost-runtime signal (the host stays alive)', async () => {
    const lost: string[] = [];
    const host = {
      ensureSession: async () => ({ sessionId: 'acp', cwd: process.cwd(), processEpoch: 'epoch', resumed: false }),
      prompt: async () => { throw new DevinAcpIdleTimeoutError(300_000, false); },
    };
    const source = new DevinCliAcpLLMSource(
      { get: async () => host } as never,
      { get: async () => ({ filesystem: false, web: false, terminal: false, source: 'default' }) } as never,
      { getToken: async () => null } as never,
      new KalioMcpBridgeContextRegistry(),
    );
    const run = async () => { for await (const _chunk of source.stream({
      messages: [{ role: 'user', content: 'Run the sweep' }], tools: [], sessionId: 'chat', messageId: 'answer',
      onExternalRuntimeLost: () => lost.push('lost'),
      executionProfile: { id: 'devin', name: 'Devin', kind: 'devin-cli-acp', model: 'swe-2-1-high', approvalMode: 'kalio_strict', enabled: true, capabilitiesVersion: '1', createdAt: 0, updatedAt: 0 },
    } satisfies LLMSourceParams)) void _chunk; };
    await expect(run()).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    expect(lost).toEqual([]);
  });

  it('retains successful end_turn with an actual answer', async () => {
    const chunks = await execute('end_turn', 'Build passed');
    expect(chunks).toContainEqual({ type: 'done' });
    expect(chunks.calls).toBe(1);
  });

  it('fails visibly, without a lost-runtime signal, when Kalio tools exist but neither bridge nor native tools are available', async () => {
    const lost: string[] = [];
    const host = { ensureSession: async () => { throw new Error('must not start a session'); } };
    const source = new DevinCliAcpLLMSource(
      { get: async () => host } as never,
      { get: async () => ({ filesystem: false, web: false, terminal: false, source: 'default' }) } as never,
      { getToken: async () => null } as never,
      new KalioMcpBridgeContextRegistry(),
    );
    const run = async () => { for await (const _chunk of source.stream({
      messages: [{ role: 'user', content: 'Read AGENTS.md' }], tools: [{ name: 'fs_read' }] as never, sessionId: 'chat', messageId: 'answer',
      onExternalRuntimeLost: () => lost.push('lost'),
      executionProfile: { id: 'devin', name: 'Devin', kind: 'devin-cli-acp', model: 'swe-2-1-high', approvalMode: 'kalio_strict', enabled: true, capabilitiesVersion: '1', createdAt: 0, updatedAt: 0 },
    } satisfies LLMSourceParams)) void _chunk; };
    await expect(run()).rejects.toThrow('DEVIN_TOOLS_UNAVAILABLE');
    expect(lost).toEqual([]);
  });
});
describe('Devin ACP lost-runtime reporting', () => {
  async function run(getStatus: (() => { status: string; processEpoch?: string }) | undefined, abort = false) {
    const lost: string[] = [];
    const controller = new AbortController();
    const host = {
      ensureSession: async () => ({ sessionId: 'acp', cwd: process.cwd(), processEpoch: 'epoch', resumed: false }),
      prompt: async () => { if (abort) controller.abort(); throw new DevinModelBindingError('Devin ACP session model differs from the requested exact ID', true); },
      ...(getStatus ? { getStatus } : {}),
    };
    const source = new DevinCliAcpLLMSource(
      { get: async () => host } as never,
      { get: async () => ({ filesystem: false, web: false, terminal: false, source: 'default' }) } as never,
      { getToken: async () => null } as never,
      new KalioMcpBridgeContextRegistry(),
    );
    const stream = async () => { for await (const _chunk of source.stream({
      messages: [{ role: 'user', content: 'hi' }], tools: [], sessionId: 'chat', messageId: 'answer', abortSignal: controller.signal,
      onExternalRuntimeLost: () => lost.push('lost'),
      executionProfile: { id: 'devin', name: 'Devin', kind: 'devin-cli-acp', model: 'swe-2-1-high', approvalMode: 'kalio_strict', enabled: true, capabilitiesVersion: '1', createdAt: 0, updatedAt: 0 },
    } satisfies LLMSourceParams)) void _chunk; };
    await expect(stream()).rejects.toBeInstanceOf(DevinModelBindingError);
    return lost;
  }

  it('does not report a lost runtime for a binding error on an online host with the same epoch', async () => {
    expect(await run(() => ({ status: 'online', processEpoch: 'epoch' }))).toEqual([]);
  });
  it('reports a lost runtime when the host epoch changed or the host is not online', async () => {
    expect(await run(() => ({ status: 'online', processEpoch: 'other' }))).toEqual(['lost']);
    expect(await run(() => ({ status: 'error', processEpoch: 'epoch' }))).toEqual(['lost']);
  });
  it('reports a lost runtime when the abort signal fired', async () => {
    expect(await run(() => ({ status: 'online', processEpoch: 'epoch' }), true)).toEqual(['lost']);
  });
  it('stays conservative when the host cannot report its status', async () => {
    expect(await run(undefined)).toEqual(['lost']);
  });
});
