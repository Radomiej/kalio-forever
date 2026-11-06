import { describe, expect, it, vi } from 'vitest';
import type { LLMStructuredOutputRequest } from '@kalio/types';
import type { InternalLLMChunk } from '../chat/interfaces/llm-chunk.types';
import type { LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import type { DevinAcpPromptInput } from './devin-cli-acp.host';
import { DevinCliAcpLLMSource } from './devin-cli-acp.llm-source';
import { KalioMcpBridgeContextRegistry } from '../../common/kalio-mcp-bridge-context';

const request: LLMStructuredOutputRequest = {
  name: 'diagnostic_route', strict: true,
  schema: { type: 'object', additionalProperties: false,
    properties: { targetNodeId: { type: 'string', enum: ['review'] } }, required: ['targetNodeId'] },
};
const answer = { targetNodeId: 'review' };
const json = JSON.stringify(answer);
type Stop = 'end_turn' | 'cancelled' | 'refusal' | 'max_tokens';

async function execute(
  emit: (input: DevinAcpPromptInput) => void,
  options: { stop?: Stop; failure?: boolean; structured?: boolean; resumed?: boolean; abort?: boolean;
    request?: LLMStructuredOutputRequest; auditAbort?: boolean; auditStale?: boolean; auditTool?: boolean } = {},
) {
  let prompt = '';
  let activeInput: DevinAcpPromptInput | undefined;
  let stale = false;
  const controller = new AbortController();
  const onExternalRuntimeLost = vi.fn(() => controller.abort());
  const host = {
    ensureSession: async () => ({ sessionId: 'fixture', cwd: process.cwd(), processEpoch: 'fixture', resumed: false }),
    prompt: async (_id: string, text: string, input: DevinAcpPromptInput) => {
      prompt = text;
      activeInput = input;
      emit(input);
      if (options.abort) controller.abort();
      if (options.failure) throw new Error('fixture host failure');
      return options.stop ?? 'end_turn';
    },
  };
  const source = new DevinCliAcpLLMSource(
    { get: async () => host } as never,
    { get: async () => ({ filesystem: false, web: false, terminal: false, source: 'default' }) } as never,
    { getToken: async () => null } as never,
    new KalioMcpBridgeContextRegistry(),
  );
  const chunks: InternalLLMChunk[] = [];
  let error: unknown;
  try {
    for await (const chunk of source.stream({
      messages: [{ role: 'user', content: 'Return the route' }], tools: [],
      sessionId: 'fixture-chat', messageId: 'fixture-answer', abortSignal: controller.signal,
      onExternalRuntimeLost,
      ...(options.structured === false ? {} : { structuredOutput: options.request ?? request }),
      ...(options.resumed ? { externalThreadId: 'fixture' } : {}),
      ...(options.auditStale ? { toolsDisabled: true, assertExecutionCurrent: () => { if (stale) throw new Error('fixture stale'); } } : {}),
      onExternalAudit: async event => {
        if (event.eventName !== 'devin-cli-acp.turn.completed') return;
        await Promise.resolve();
        if (options.auditAbort) controller.abort();
        if (options.auditStale) stale = true;
        if (options.auditTool) activeInput?.onToolActivity?.({ toolCallId: 'late', status: 'completed' });
      },
      executionProfile: { id: 'devin', name: 'Devin', kind: 'devin-cli-acp', model: 'swe-2-high',
        approvalMode: 'kalio_strict', enabled: true, capabilitiesVersion: '1', createdAt: 0, updatedAt: 0 },
    } satisfies LLMSourceParams)) chunks.push(chunk);
  } catch (caught) {
    error = caught;
  }
  return { chunks, error, prompt, onExternalRuntimeLost, aborted: controller.signal.aborted };
}

describe('Devin structured-output contract (real source, mock host)', () => {
  it('leaves a healthy ACP session available for one format repair after rejecting prose and fenced JSON', async () => {
    const result = await execute(input => input.onText('Routing to review.\n```json\n' + json + '\n```'));
    expect(result.error).toMatchObject({ code: 'LLM_BAD_STRUCTURED_OUTPUT' });
    expect(result.chunks.some(chunk => chunk.type === 'structured_output')).toBe(false);
    expect(result.onExternalRuntimeLost).not.toHaveBeenCalled();
    expect(result.aborted).toBe(false);
  });

  it('still reports actual host failure as runtime loss', async () => {
    const result = await execute(() => undefined, { failure: true });
    expect(result.onExternalRuntimeLost).toHaveBeenCalledOnce();
    expect(result.aborted).toBe(true);
  });

  it('does not enable format repair after an observed ACP tool completed', async () => {
    const result = await execute(input => {
      input.onToolActivity?.({ toolCallId: 'write', status: 'completed', name: 'fs_write' });
      input.onText('Malformed final answer');
    });
    expect(result.error).toMatchObject({ code: 'LLM_BAD_STRUCTURED_OUTPUT' });
    expect(result.onExternalRuntimeLost).toHaveBeenCalledOnce();
  });

  it.each([false, true])('instructs the host with exact requested schema (resumed=%s)', async resumed => {
    const result = await execute(input => input.onText(json), { resumed });
    expect(result.prompt).toContain(request.name);
    expect(result.prompt).toContain(JSON.stringify(request.schema));
  });

  it('emits validated chunk once, before done, for a fragmented complete JSON response', async () => {
    const result = await execute(input => { input.onText(json.slice(0, 8)); input.onText(json.slice(8)); });
    expect(result.error).toBeUndefined();
    expect(result.chunks.filter(chunk => chunk.type === 'structured_output')).toEqual([{ type: 'structured_output', value: answer }]);
    expect(result.chunks.at(-2)).toEqual({ type: 'structured_output', value: answer });
    expect(result.chunks.at(-1)).toEqual({ type: 'done' });
  });

  it('validates only the post-tool final answer, preserving ordinary streamed text', async () => {
    const result = await execute(input => {
      input.onText('Inspecting source first.');
      input.onToolActivity?.({ toolCallId: 'read', status: 'in_progress', name: 'fs_read' });
      input.onToolActivity?.({ toolCallId: 'read', status: 'completed', name: 'fs_read', rawOutput: 'untrusted tool data' });
      input.onText(json);
    });
    expect(result.error).toBeUndefined();
    expect(result.chunks).toContainEqual({ type: 'text_delta', delta: 'Inspecting source first.' });
    expect(result.chunks).toContainEqual({ type: 'structured_output', value: answer });
  });

  it.each([
    ['prose', `Route: ${json}`], ['fence', '```json\n' + json + '\n```'],
    ['wrapper', JSON.stringify({ output: answer })], ['extra key', JSON.stringify({ ...answer, extra: true })],
    ['wrong target', '{"targetNodeId":"unknown"}'], ['invalid JSON', '{'],
  ])('fails closed for %s', async (_label, text) => {
    const result = await execute(input => input.onText(text));
    expect(result.chunks.some(chunk => chunk.type === 'structured_output' || chunk.type === 'done')).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('does not reuse a pre-tool JSON answer when no post-tool final answer exists', async () => {
    const result = await execute(input => {
      input.onText(json);
      input.onToolActivity?.({ toolCallId: 'read', status: 'completed', name: 'fs_read' });
    });
    expect(result.chunks.some(chunk => chunk.type === 'structured_output' || chunk.type === 'done')).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it.each(['cancelled', 'refusal', 'max_tokens'] as const)('never emits structured output or done after %s', async stop => {
    const result = await execute(input => input.onText(json), { stop });
    expect(result.chunks.some(chunk => chunk.type === 'structured_output' || chunk.type === 'done')).toBe(false);
  });

  it('never emits success after host failure', async () => {
    const result = await execute(input => input.onText(json), { failure: true });
    expect(result.error).toBeInstanceOf(Error);
    expect(result.chunks.some(chunk => chunk.type === 'structured_output' || chunk.type === 'done')).toBe(false);
  });

  it('never emits success when aborted before host returns end_turn', async () => {
    const result = await execute(input => input.onText(json), { abort: true });
    expect(result.chunks.some(chunk => chunk.type === 'structured_output' || chunk.type === 'done')).toBe(false);
  });

  it('preserves unstructured text-only completion', async () => {
    const result = await execute(input => input.onText('Normal answer'), { structured: false });
    expect(result.error).toBeUndefined();
    expect(result.chunks).toEqual([{ type: 'text_delta', delta: 'Normal answer' }, { type: 'done' }]);
  });

  it.each(['auditAbort', 'auditStale', 'auditTool'] as const)('rechecks %s after awaited completion audit', async option => {
    const result = await execute(input => input.onText(json), { [option]: true });
    expect(result.error).toBeInstanceOf(Error);
    expect(result.chunks.some(chunk => chunk.type === 'structured_output' || chunk.type === 'done')).toBe(false);
  });

  it('waits for overlapping tools and uses only text after both complete', async () => {
    const result = await execute(input => {
      input.onToolActivity?.({ toolCallId: 'a', status: 'in_progress' });
      input.onToolActivity?.({ toolCallId: 'b', status: 'pending' });
      input.onToolActivity?.({ toolCallId: 'a', status: 'completed' });
      input.onText('intermediate prose while b is pending');
      input.onToolActivity?.({ toolCallId: 'b', status: 'completed' });
      input.onText(json);
    });
    expect(result.error).toBeUndefined();
    expect(result.chunks).toContainEqual({ type: 'structured_output', value: answer });
  });

  it('accepts completed-without-start only with a new subsequent JSON answer', async () => {
    const result = await execute(input => {
      input.onToolActivity?.({ toolCallId: 'a', status: 'completed' });
      input.onText(json);
    });
    expect(result.error).toBeUndefined();
    expect(result.chunks).toContainEqual({ type: 'structured_output', value: answer });
  });

  it.each(['late duplicate', 'missing status', 'pending', 'restarted terminal'] as const)('rejects ambiguous final boundary: %s', async mode => {
    const result = await execute(input => {
      if (mode === 'pending') {
        input.onToolActivity?.({ toolCallId: 'a', status: 'in_progress' });
        input.onText(json);
      } else {
        input.onToolActivity?.({ toolCallId: 'a', status: 'completed' });
        input.onText(json);
        input.onToolActivity?.({ toolCallId: 'a', ...(mode === 'missing status' ? {} : { status: mode === 'restarted terminal' ? 'in_progress' : 'completed' }) });
        if (mode === 'restarted terminal') {
          input.onToolActivity?.({ toolCallId: 'a', status: 'completed' });
          input.onText(json);
        }
      }
    });
    expect(result.error).toMatchObject({ code: 'LLM_BAD_STRUCTURED_OUTPUT' });
    expect(result.chunks.some(chunk => chunk.type === 'structured_output' || chunk.type === 'done')).toBe(false);
  });

  it.each([
    { type: 'not-a-type' }, { type: 'object', inventedKeyword: true },
    { $async: true, type: 'object' }, { $ref: 'https://unresolved.invalid/schema' },
  ])('rejects invalid/unsupported schema before invoking host prompt: %j', async schema => {
    const result = await execute(input => input.onText(json), { request: { ...request, schema } });
    expect(result.prompt).toBe('');
    expect(result.error).toMatchObject({ code: 'LLM_STRUCTURED_OUTPUT_SCHEMA_INVALID' });
    expect(result.chunks).toEqual([]);
  });

  it('bounds final text including whitespace', async () => {
    const result = await execute(input => { input.onText(' '.repeat(65_536)); input.onText(json); });
    expect(result.error).toMatchObject({ code: 'LLM_BAD_STRUCTURED_OUTPUT' });
    expect(result.chunks.some(chunk => chunk.type === 'structured_output' || chunk.type === 'done')).toBe(false);
  });

  // Snapshot of architecture-structured-output-contracts.ts finalizer schema.
  // Kept local to avoid cross-module implementation imports in this adapter suite.
  const finalizer: LLMStructuredOutputRequest = { name: 'architecture_final_artifact', strict: true, schema: {
    type: 'object', additionalProperties: false,
    properties: { status: { type: 'string', enum: ['accepted', 'blocked', 'rejected', 'incomplete'] },
      blockingReason: { type: ['string', 'null'] }, evidence: { type: 'array', items: { type: 'string' } }, answer: { type: 'string' } },
    required: ['status', 'blockingReason', 'evidence', 'answer'],
  } };

  it.each([false, true])('validates actual architecture final artifact (resumed=%s)', async resumed => {
    const artifact = { status: 'accepted', blockingReason: null, evidence: ['fixture-only local checks'], answer: 'Ready for review' };
    const result = await execute(input => input.onText(JSON.stringify(artifact)), { request: finalizer, resumed });
    expect(result.error).toBeUndefined();
    expect(result.chunks).toContainEqual({ type: 'structured_output', value: artifact });
  });

  it('emits the actual architecture-shaped router contract through the real source', async () => {
    const insight = { type: 'object', additionalProperties: false, properties: {
      fromSlot: { type: 'string' }, insight: { type: 'string' }, whyAccepted: { type: ['string', 'null'] },
      whyRejected: { type: ['string', 'null'] },
    }, required: ['fromSlot', 'insight', 'whyAccepted', 'whyRejected'] };
    const risk = { type: 'object', additionalProperties: false, properties: {
      risk: { type: 'string' }, mitigation: { type: 'string' }, sourceSlot: { type: 'string' },
    }, required: ['risk', 'mitigation', 'sourceSlot'] };
    const router: LLMStructuredOutputRequest = { name: 'architecture_router_output', strict: true, schema: {
      type: 'object', additionalProperties: false, properties: {
        selectedStrategy: { type: 'string' }, mergedDecision: { type: 'string' },
        acceptedInputs: { type: 'array', items: insight }, rejectedInputs: { type: 'array', items: insight },
        unresolvedConflicts: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: risk },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        nextAction: { type: 'string', enum: ['finalize', 'ask_human', 'route_to', 'run_more_research', 'rerun_with_different_personas'] },
        targetNodeId: { type: ['string', 'null'] }, response: { type: ['string', 'null'] },
      }, required: ['selectedStrategy', 'mergedDecision', 'acceptedInputs', 'rejectedInputs', 'unresolvedConflicts',
        'risks', 'confidence', 'nextAction', 'targetNodeId', 'response'],
    } };
    const route = { selectedStrategy: 'review', mergedDecision: 'Review the fixture', acceptedInputs: [],
      rejectedInputs: [], unresolvedConflicts: [], risks: [], confidence: 0.8, nextAction: 'route_to',
      targetNodeId: 'review', response: null };
    const result = await execute(input => {
      input.onThought('Internal thought is not part of JSON.');
      input.onText('Reading first.');
      input.onToolActivity?.({ toolCallId: 'read', status: 'completed', rawOutput: '{"nextAction":"finalize"}' });
      input.onText(JSON.stringify(route));
    }, { request: router });
    expect(result.error).toBeUndefined();
    expect(result.chunks.at(-2)).toEqual({ type: 'structured_output', value: route });
    expect(result.chunks.at(-1)).toEqual({ type: 'done' });
  });
});
