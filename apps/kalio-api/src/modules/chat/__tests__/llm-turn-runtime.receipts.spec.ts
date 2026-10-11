import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, HostRuntimeToolAdmission, HostRuntimeToolCommit, LLMToolCall } from '@kalio/types';
import { LLMTurnRuntimeService } from '../llm-turn-runtime.service';
import { SessionManagerService } from '../session-manager.service';
import { StreamProcessorService } from '../stream-processor.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import { ToolConfirmationService } from '../tool-confirmation.service';
import { DoneHandler } from '../handlers/done.handler';
import { ToolCallHandler } from '../handlers/tool-call.handler';
import { TextDeltaHandler } from '../handlers/text-delta.handler';
import type { IMessageRepository } from '../interfaces/message-repository.interface';
import type { ILLMSource, LLMSourceParams } from '../interfaces/llm-source.interface';
import type { LLMAgentLoopRequest } from '../llm-turn-runtime.types';
import type { HostDispatchReceiptService } from '../host-dispatch-receipt.service';

function fixture(options: { receiptService?: HostDispatchReceiptService; native?: boolean; fail?: 'admit' | 'commit' | 'save' | 'ack'; call?: LLMToolCall; ack?: boolean; saveGate?: Promise<void>; earlyDone?: boolean; activityOnly?: boolean } = {}) {
  const rows = new Map<string, ChatMessage>();
  const order: string[] = [];
  const writes: Record<string, unknown>[] = [];
  const observer = {
    admit: vi.fn(async (_call: HostRuntimeToolAdmission) => { order.push('admit'); if (options.fail === 'admit') throw Object.assign(new Error('observer rejected'), { code: 'LLM_BAD_STRUCTURED_OUTPUT' }); }),
    commit: vi.fn(async (_receipt: HostRuntimeToolCommit) => { order.push('commit'); if (options.fail === 'commit') throw new Error('observer rejected'); }),
    drain: vi.fn(async () => undefined), journalComplete: vi.fn(async () => undefined),
  };
  const repo: IMessageRepository = {
    ensureSession: async () => undefined,
    loadHistory: async sessionId => [...rows.values()].filter(row => row.sessionId === sessionId),
    loadHistoryPage: async () => ({ messages: [], totalCount: 0, hasMoreBefore: false, oldestLoadedMessageId: null }),
    saveMessage: async row => {
      if (row.role === 'tool_result') {
        order.push('save');
        await options.saveGate;
        if (options.fail === 'save') throw new Error('save rejected');
      }
      rows.set(row.id, structuredClone(row));
    },
  };
  const sessions = new SessionManagerService(repo, {} as never,
    { getContextWindowSize: async () => 32_000 } as never,
    { getNonReplayableTurnIds: async () => new Set() } as never);
  const confirmations = new ToolConfirmationService(null, null);
  vi.spyOn(confirmations, 'approveOrRequestConfirmation').mockResolvedValue({ approved: true, execution: { requestId: 'approval', revision: 2 } });
  vi.spyOn(confirmations, 'finishLiveExecution').mockImplementation(async () => {
    order.push('ack'); if (options.fail === 'ack') throw new Error('ack rejected');
  });
  vi.spyOn(confirmations, 'finishLiveExecutionRequired').mockImplementation(async () => {
    order.push('ack'); if (options.fail === 'ack') throw new Error('ack rejected');
    return { requestId: 'approval', claimedRevision: 2, committedRevision: 3, status: 'approved',
      executionState: 'tool_result_committed', resultStatus: 'success' };
  });
  const dispatcher = new ToolDispatchService([{
    meta: { name: 'fs_write', description: 'fixture', parameters: {}, requiresConfirmation: options.ack ?? false },
    execute: async request => { order.push('execute'); writes.push(request.args); return { text: 'Zażółć 🧪\r\n' }; },
  }], null, null, null, null, confirmations);
  const processor = new StreamProcessorService([new DoneHandler(sessions), new ToolCallHandler(), new TextDeltaHandler()], []);
  processor.onModuleInit();
  const call = options.call ?? { id: 'raw-call', name: 'raw-name', args: { path: 'raw.txt', nested: { value: 1 } } };
  const transform = vi.fn((input: LLMToolCall) => ({ id: `${input.id}-effective`, name: 'fs_write', args: { ...input.args, path: `${String(input.args['path'])}.effective` } }));
  let providerRequest: LLMSourceParams | undefined;
  let streams = 0;
  let nativeFailure: unknown;
  const source: ILLMSource = { async *stream(params) {
    providerRequest = params; streams++;
    if (options.activityOnly) {
      await params.onExternalAudit?.({ eventName: 'native.tool.completed', status: 'completed', data: { toolName: 'fs_write', result: 'claimed success' } });
    } else if (streams === 1) {
      if (options.native) {
        const nativeOptions = { abortSignal: new AbortController().signal };
        const executions = Promise.all([params.dispatchNativeTool!(call, nativeOptions), params.dispatchNativeTool!(call, nativeOptions)]);
        if (options.earlyDone) void executions.catch(error => { nativeFailure = error; }); // Lane drain remains authoritative.
        else await executions;
      } else yield { type: 'tool_call', callId: call.id, name: call.name, args: call.args };
    }
    yield { type: 'text_delta', delta: 'Finished' };
    yield { type: 'done' };
  } };
  const runtime = new LLMTurnRuntimeService(source, processor, sessions, dispatcher, undefined, undefined, options.receiptService);
  const run = (overrides: Partial<LLMAgentLoopRequest> = {}) => runtime.runAgentLoop({
    runtimeKind: 'subagent', sessionId: 'child', runId: 'journal', turnId: 'turn', promptMessageId: 'prompt',
    personaId: 'worker', effectiveSystemPrompt: 'fixture', toolMetas: dispatcher.getToolMetas(), maxIterations: 2,
    emit: () => undefined, abortSignal: new AbortController().signal, providerCompletesTurn: options.native,
    transformToolCall: transform, hostRuntimeReceiptObserver: observer,
    structuredOutput: { name: 'fixture', schema: { type: 'object' } },
    ...overrides,
  });
  return { run, rows, order, writes, observer, transform, call, dispatcher, get nativeFailure() { return nativeFailure; }, get streams() { return streams; }, get providerRequest() { return providerRequest; } };
}

describe('host receipt observer at the actual dispatcher persistence boundary', () => {
  it('uses the injected host recorder only for observed runs without a caller override', async () => {
    const createCallRecorder = vi.fn(() => ({ resolved: async () => undefined,
      entered: () => undefined, commit: async () => ({} as never) }));
    const receiptService = { recorder: { createCallRecorder } } as unknown as HostDispatchReceiptService;
    const f = fixture({ receiptService });
    await f.run();
    expect(createCallRecorder).toHaveBeenCalledOnce();
    expect(f.providerRequest).not.toHaveProperty('hostDispatchReceiptRecorder');
    const legacy = fixture({ receiptService });
    await legacy.run({ hostRuntimeReceiptObserver: undefined });
    expect(createCallRecorder).toHaveBeenCalledOnce();
  });
  it('records actual entry and durable result before observer commit without exposing the recorder to the provider', async () => {
    const f = fixture({ ack: true });
    const recorder = {
      resolved: vi.fn(async () => { f.order.push('capture'); }),
      entered: vi.fn(() => { f.order.push('entered'); }),
      commit: vi.fn(async () => { f.order.push('receipt'); return {} as never; }),
      recordCancelled: vi.fn(async () => { throw new Error('unexpected cancellation recording'); }),
    };
    const createCallRecorder = vi.fn(() => recorder);
    await f.run({ hostDispatchReceiptRecorder: { createCallRecorder } });
    expect(f.order).toEqual(['admit', 'capture', 'entered', 'execute', 'save', 'ack', 'receipt', 'commit']);
    expect(createCallRecorder).toHaveBeenCalledOnce();
    expect(recorder.entered.mock.calls[0]).toEqual(recorder.resolved.mock.calls[0]);
    expect(recorder.commit.mock.calls[0]).toEqual(f.observer.commit.mock.calls[0]);
    expect(f.providerRequest).not.toHaveProperty('hostDispatchReceiptRecorder');
  });
  it('does not commit observer evidence or retry execution after recorder persistence fails', async () => {
    const f = fixture();
    await expect(f.run({ hostDispatchReceiptRecorder: { createCallRecorder: () => ({
      resolved: async () => undefined, entered: () => undefined,
      commit: async () => { throw new Error('HOST_DISPATCH_RECEIPT_STORAGE'); },
      recordCancelled: async () => { throw new Error('unexpected cancellation recording'); },
    }) } })).rejects.toThrow('HOST_DISPATCH_RECEIPT_STORAGE');
    expect(f.writes).toHaveLength(1);
    expect(f.observer.commit).not.toHaveBeenCalled();
  });
  it('does not commit resolved authority when the executor was never entered', async () => {
    const f = fixture();
    vi.spyOn(f.dispatcher, 'dispatch').mockImplementation(async (callId, name, args, ctx) => {
      await ctx.onResolvedToolDispatch?.({ identity: { runId: 'journal', sessionId: 'child', turnId: 'turn', promptMessageId: 'prompt' },
        callId, requestedName: name, canonicalName: name, args,
        target: { kind: 'external_mcp', serverKey: 'fixture', originalName: name },
        approval: { kind: 'non_durable', reason: 'not_required' } });
      return { callId, status: 'cancelled' };
    });
    await f.run();
    expect(f.writes).toHaveLength(0);
    expect(f.observer.commit).toHaveBeenCalledWith(expect.objectContaining({ resolvedDispatch: null, status: 'cancelled' }));
  });
  it.each([false, true])('transforms once, admits detached actual args and commits exact persisted UTF-8 bytes (native=%s)', async native => {
    const f = fixture({ native, ack: true });
    await f.run();
    expect(f.transform).toHaveBeenCalledOnce();
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]?.['path']).toBe('raw.txt.effective');
    expect(f.order).toEqual(['admit', 'execute', 'save', 'ack', 'commit']);
    const admission = f.observer.admit.mock.calls[0]?.[0];
    expect(admission).toMatchObject({ identity: { runId: 'journal', sessionId: 'child', turnId: 'turn', promptMessageId: 'prompt' }, callId: 'raw-call-effective', toolName: 'fs_write', args: { path: 'raw.txt.effective' } });
    expect(admission?.args).toEqual(f.writes[0]);
    expect(Object.isFrozen(admission?.args)).toBe(true);
    expect(Object.isFrozen(admission?.args['nested'])).toBe(true);
    (f.call.args['nested'] as { value: number }).value = 7;
    expect(admission?.args['nested']).toEqual({ value: 1 });
    const row = [...f.rows.values()].find(message => message.role === 'tool_result')!;
    expect(row.content).toBe('{"text":"Zażółć 🧪\\r\\n"}');
    expect(f.observer.commit).toHaveBeenCalledWith(expect.objectContaining({ identity: { runId: 'journal', sessionId: 'child', turnId: 'turn', promptMessageId: 'prompt' }, callId: 'raw-call-effective', toolName: 'fs_write', persistedMessageId: row.id, contentSha256: createHash('sha256').update(row.content, 'utf8').digest('hex'), status: 'success', registeredCommitAck: 'acknowledged',
      resolvedDispatch: expect.objectContaining({ canonicalName: 'fs_write', args: f.writes[0],
        approval: { kind: 'durable_confirmation', requestId: 'approval', claimedRevision: 2 } }),
      hitlCommit: { requestId: 'approval', claimedRevision: 2, committedRevision: 3, status: 'approved',
        executionState: 'tool_result_committed', resultStatus: 'success' } }));
    expect(f.providerRequest).not.toHaveProperty('hostRuntimeReceiptObserver');
    expect(f.observer.drain).not.toHaveBeenCalled(); // Subagent owner drains after its own terminal writes.
  });

  it.each(['admit', 'commit', 'save', 'ack'] as const)('fails closed on %s without replaying a side effect', async fail => {
    const f = fixture({ fail, ack: true });
    await expect(f.run()).rejects.toThrow('rejected');
    expect(f.streams).toBe(1);
    expect(f.writes).toHaveLength(fail === 'admit' ? 0 : 1);
    expect(f.observer.commit).toHaveBeenCalledTimes(fail === 'commit' ? 1 : 0);
  });

  it('rejects nested accessors before invoking getters or executing tools', async () => {
    let reads = 0;
    const nested = Object.defineProperty({}, 'value', { enumerable: true, get: () => { reads++; return 1; } });
    const f = fixture({ call: { id: 'raw-call', name: 'raw-name', args: { nested } } });
    await expect(f.run()).rejects.toThrow();
    expect(reads).toBe(0);
    expect(f.writes).toHaveLength(0);
  });

  it('rejects a post-transform args accessor without invoking it', async () => {
    let reads = 0;
    const f = fixture();
    const transformed = Object.defineProperty({ id: 'effective', name: 'fs_write' }, 'args', {
      enumerable: true, get: () => { reads++; return { path: 'forged' }; },
    }) as LLMToolCall;
    await expect(f.run({ transformToolCall: () => transformed })).rejects.toThrow();
    expect(reads).toBe(0); expect(f.writes).toHaveLength(0);
  });

  it('does not invent a registered commit ACK for tools without a callback', async () => {
    const f = fixture(); await f.run();
    expect(f.observer.commit).toHaveBeenCalledWith(expect.objectContaining({ registeredCommitAck: 'not_registered' }));
  });

  it('transforms once in legacy non-observed runs too', async () => {
    const f = fixture(); await f.run({ hostRuntimeReceiptObserver: undefined });
    expect(f.transform).toHaveBeenCalledOnce();
    expect(f.writes[0]?.['path']).toBe('raw.txt.effective');
  });

  it('waits for late native tool result persistence after the provider emits done', async () => {
    let release!: () => void;
    const saveGate = new Promise<void>(resolve => { release = resolve; });
    const f = fixture({ native: true, earlyDone: true, saveGate, ack: true });
    let settled = false;
    const run = f.run().then(result => { settled = true; return result; });
    await vi.waitFor(() => expect(f.order).toContain('save'));
    expect(settled).toBe(false);
    expect(f.observer.commit).not.toHaveBeenCalled();
    release(); await run;
    expect(f.order).toEqual(['admit', 'execute', 'save', 'ack', 'commit']);
  });

  it('does not turn provider native activity claims into host receipts', async () => {
    const f = fixture({ activityOnly: true });
    await f.run({ onExternalAudit: async () => undefined });
    expect(f.observer.admit).not.toHaveBeenCalled();
    expect(f.observer.commit).not.toHaveBeenCalled();
    expect(f.writes).toHaveLength(0);
  });

  it.each(['runId', 'turnId', 'promptMessageId'] as const)('rejects missing %s before streaming or execution', async key => {
    const f = fixture(); await expect(f.run({ [key]: undefined })).rejects.toThrow('identity');
    expect(f.streams).toBe(0); expect(f.writes).toHaveLength(0);
  });

  it.each(['symbol', 'hidden', 'sparse', 'array extra', 'array prototype', 'proxy', 'cycle'] as const)('rejects %s argument descriptors without executing a tool', async kind => {
    const nested: Record<string | symbol, unknown> = {};
    let value: unknown = nested;
    if (kind === 'symbol') nested[Symbol('hidden')] = 1;
    if (kind === 'hidden') Object.defineProperty(nested, 'hidden', { value: 1 });
    if (kind === 'sparse') value = new Array(1);
    if (kind === 'array extra') value = Object.assign([], { hidden: 1 });
    if (kind === 'array prototype') value = Object.setPrototypeOf([], Object.create(Array.prototype));
    if (kind === 'proxy') value = new Proxy({}, { ownKeys: () => { throw new Error('proxy invoked'); } });
    if (kind === 'cycle') nested['self'] = nested;
    const f = fixture({ call: { id: 'raw-call', name: 'raw-name', args: { nested: value } } });
    await expect(f.run()).rejects.toThrow(/Host receipt|host receipt/);
    expect(f.writes).toHaveLength(0);
  });
});
