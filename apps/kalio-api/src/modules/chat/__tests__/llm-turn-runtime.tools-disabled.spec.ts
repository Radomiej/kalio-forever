import { describe, expect, it, vi } from 'vitest';
import type { ToolMeta } from '@kalio/types';
import { LLMTurnRuntimeService } from '../llm-turn-runtime.service';
import type { LLMAgentLoopRequest } from '../llm-turn-runtime.types';
import type { LLMSourceParams } from '../interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';
import type { StreamContext } from '../interfaces/stream-context.interface';
import { createRuntimeToolDispatcher } from '../llm-turn-runtime-dispatch';

const tool: ToolMeta = { name: 'worker-tool', description: 'fixture', parameters: { type: 'object' }, requiresConfirmation: false };
function fixture(plans: Array<InternalLLMChunk[] | Error>) {
  const seen: LLMSourceParams[] = [];
  const source = { stream: vi.fn(async function* (params: LLMSourceParams) {
    seen.push(params);
    const plan = plans.shift() ?? [{ type: 'done' }];
    if (plan instanceof Error) throw plan;
    for (const chunk of plan) yield chunk;
  }) };
  const processor = { process: vi.fn(async (chunk: InternalLLMChunk, ctx: StreamContext) => {
    if (chunk.type === 'text_delta') ctx.state.text += chunk.delta;
    if (chunk.type === 'tool_call') ctx.state.addToolCall({ id: chunk.callId, name: chunk.name, args: chunk.args });
  }) };
  const sessions = { loadHistoryForLLM: vi.fn().mockResolvedValue({ history: [], unboundedHistoryCount: 0 }),
    persistAssistantMessage: vi.fn(), saveToolResult: vi.fn() };
  const dispatch = { dispatch: vi.fn() };
  const runtime = new LLMTurnRuntimeService(source, processor as never, sessions as never, dispatch as never);
  const request: LLMAgentLoopRequest = { toolsDisabled: true, runtimeKind: 'subagent', sessionId: 'review',
    personaId: 'reviewer', effectiveSystemPrompt: 'Review', toolMetas: [tool], providerToolNames: ['native-web'],
    rawXmlToolNames: ['worker-tool'], abortSignal: new AbortController().signal, emit: vi.fn(), maxIterations: 3 };
  return { runtime, request, seen, processor, sessions, dispatch };
}
function narrowed(params: LLMSourceParams) {
  expect(params.toolsDisabled).toBe(true); expect(params.tools).toEqual([]);
  expect(params.providerToolNames).toEqual([]); expect(params.dispatchNativeTool).toBeUndefined();
  expect(params.toolResultChannel).toBeUndefined();
}
describe('one-way toolsDisabled runtime', () => {
  it('survives empty retries and subsequent iterations without tool channels', async () => {
    const f = fixture([[{ type: 'done' }], [{ type: 'text_delta', delta: 'reviewed' }, { type: 'done' }]]);
    await f.runtime.runAgentLoop({ ...f.request, maxEmptyNoToolRetries: 1 });
    expect(f.seen).toHaveLength(2); f.seen.forEach(narrowed);
    expect(f.sessions.loadHistoryForLLM).toHaveBeenCalledWith('review', expect.objectContaining({ toolMetas: [] }));
    expect(f.dispatch.dispatch).not.toHaveBeenCalled();
  });
  it('survives structured-output repair with the same restriction', async () => {
    const error = Object.assign(new Error('Invalid structured output: fixture'), { code: 'LLM_BAD_STRUCTURED_OUTPUT' });
    const f = fixture([error, [{ type: 'structured_output', value: { verdict: 'review' } }, { type: 'done' }]]);
    const result = await f.runtime.runAgentLoop({ ...f.request, structuredOutput: { name: 'review', strict: true,
      schema: { type: 'object', properties: { verdict: { type: 'string' } }, required: ['verdict'] } } });
    expect(result.structuredOutput).toEqual({ verdict: 'review' });
    expect(f.seen).toHaveLength(2); f.seen.forEach(narrowed);
  });
  it.each(['unknown-tool', 'worker-tool'])('rejects generated %s before processing or dispatch', async name => {
    const f = fixture([[{ type: 'tool_call', callId: 'call', name, args: {} }]]);
    await expect(f.runtime.runAgentLoop({ ...f.request, providerCompletesTurn: true })).rejects.toThrow('LLM_TOOLS_DISABLED');
    expect(f.processor.process).not.toHaveBeenCalled(); expect(f.dispatch.dispatch).not.toHaveBeenCalled();
    expect(f.sessions.persistAssistantMessage).not.toHaveBeenCalled(); expect(f.sessions.saveToolResult).not.toHaveBeenCalled();
  });
  it('preserves ordinary tool/channel params when restriction absent', async () => {
    const f = fixture([[{ type: 'done' }]]);
    const { toolsDisabled: _removed, ...ordinary } = f.request;
    await f.runtime.runAgentLoop(ordinary);
    expect(f.seen[0]?.toolsDisabled).toBeUndefined(); expect(f.seen[0]?.tools).toEqual([tool]);
    expect(f.seen[0]?.providerToolNames).toEqual(['native-web']);
    expect(f.seen[0]?.dispatchNativeTool).toBeTypeOf('function'); expect(f.seen[0]?.toolResultChannel).toBeDefined();
  });
  it('rejects direct dispatcher calls before lane, transform or persistence', async () => {
    const f = fixture([]); const getExecution = vi.fn(); const execute = vi.fn(); const transform = vi.fn();
    const request = { ...f.request, transformToolCall: transform };
    const call = createRuntimeToolDispatcher({ request,
      lane: { getExecution, execute } as never, context: vi.fn(), failureSignal: new AbortController().signal,
      sessionManager: f.sessions as never, toolDispatch: f.dispatch as never, resultHandler: vi.fn() });
    delete request.toolsDisabled; // Once captured, later mutation cannot widen this dispatcher.
    await expect(call({ id: 'unexpected', name: 'unknown-tool', args: {} })).rejects.toThrow('LLM_TOOLS_DISABLED');
    for (const fn of [getExecution, execute, transform, f.sessions.persistAssistantMessage, f.dispatch.dispatch])
      expect(fn).not.toHaveBeenCalled();
  });
});
