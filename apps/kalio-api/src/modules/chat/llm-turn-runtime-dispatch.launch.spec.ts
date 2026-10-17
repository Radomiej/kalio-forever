import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMToolCall } from '@kalio/types';
import * as schema from '../../database/schema';
import type { DrizzleService } from '../../database/drizzle.service';
import { DrizzleMessageRepository } from './drizzle-message.repository';
import { SessionEventsService } from './session-events.service';
import { createMessageSessions } from './__tests__/message-session.fixture';
import { SessionManagerService } from './session-manager.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { ToolConfirmationService } from './tool-confirmation.service';
import { TurnExecutionLane } from './llm-turn-tool-execution';
import { createRuntimeToolDispatcher } from './llm-turn-runtime-dispatch';
import { TurnState } from './turn-state';
import { ToolCallHandler } from './handlers/tool-call.handler';
import { DoneHandler } from './handlers/done.handler';
import { StreamProcessorService } from './stream-processor.service';
import { LLMTurnRuntimeService } from './llm-turn-runtime.service';
import type { LLMAgentLoopRequest } from './llm-turn-runtime.types';
import type { StreamContext } from './interfaces/stream-context.interface';

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(options: { gate?: Promise<void>; fail?: boolean; transform?: boolean; name?: string } = {}) {
  const client = new Database(':memory:'); databases.push(client);
  client.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY,session_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,
    turn_id TEXT,prompt_message_id TEXT,thinking TEXT,tool_calls TEXT,tool_call_id TEXT,attachments TEXT,created_at INTEGER NOT NULL);`);
  const database = { db: drizzle(client, { schema }) } as unknown as DrizzleService;
  createMessageSessions(client, ['session']);
  const repo = new DrizzleMessageRepository(database, new SessionEventsService());
  const started = deferred(); const order: string[] = [];
  const save = repo.saveMessage.bind(repo);
  const assistantWrites = vi.fn(async (message: Parameters<typeof repo.saveMessage>[0]) => {
    if (message.role === 'assistant') {
      order.push('save:start'); started.resolve(); await options.gate;
      if (options.fail) throw new Error('ASSISTANT_ACK_FAILED');
    }
    await save(message); if (message.role === 'assistant') order.push('save:ack');
  });
  repo.saveMessage = assistantWrites;
  const sessions = new SessionManagerService(repo, {} as never, { getContextWindowSize: async () => 32_000 } as never,
    { getNonReplayableTurnIds: async () => new Set() } as never);
  const execution = new AbortController(); const failure = new AbortController();
  const call: LLMToolCall = { id: 'raw', name: options.name ?? 'run_sub_agentflow', args: { goal: 'fixture' } };
  const transform = vi.fn((raw: LLMToolCall) => options.transform ? { id: 'effective', name: 'run_sub_agentflow', args: { ...raw.args, approved: 'host-transform' } } : raw);
  const execute = vi.fn(async () => {
    order.push('execute');
    const assistant = (await repo.loadHistory('session')).find(row => row.id === 'assistant');
    if (call.name === 'run_sub_agentflow' || options.transform) {
      expect(assistant).toMatchObject({ turnId: 'turn', promptMessageId: 'prompt', toolCalls: [{ id: options.transform ? 'effective' : 'raw', name: 'run_sub_agentflow' }] });
    }
    return { launched: true };
  });
  const toolDispatch = new ToolDispatchService([{ meta: { name: options.name ?? 'run_sub_agentflow', description: 'fixture', parameters: {}, requiresConfirmation: false }, execute }],
    null, null, null, null, new ToolConfirmationService(null, null));
  const state = new TurnState();
  const context: StreamContext = { sessionId: 'session', messageId: 'assistant', turnId: 'turn', promptMessageId: 'prompt',
    abortSignal: execution.signal, state, emit: vi.fn() };
  const request: LLMAgentLoopRequest = { runtimeKind: 'chat', sessionId: 'session', firstMessageId: 'assistant', turnId: 'turn', promptMessageId: 'prompt',
    personaId: 'persona', effectiveSystemPrompt: 'fixture', toolMetas: toolDispatch.getToolMetas(), abortSignal: execution.signal, emit: context.emit,
    maxIterations: 1, providerCompletesTurn: true, transformToolCall: transform };
  const lane = new TurnExecutionLane();
  const dispatch = createRuntimeToolDispatcher({ request, lane, context: () => context, failureSignal: failure.signal, sessionManager: sessions, toolDispatch, resultHandler: () => undefined });
  return { client, repo, sessions, started, order, assistantWrites, execute, execution, failure, call, transform, state, context, request, lane, dispatch, toolDispatch };
}
describe('launch assistant persistence ACK (real SessionManager + SQLite)', () => {
  it('gates the actual providerCompletesTurn streaming launch before executor entry', async () => {
    const gate = deferred(); const f = fixture({ gate: gate.promise });
    const processor = new StreamProcessorService([new ToolCallHandler(), new DoneHandler(f.sessions)], []); processor.onModuleInit();
    const runtime = new LLMTurnRuntimeService({ async *stream() {
      yield { type: 'tool_call', callId: f.call.id, name: f.call.name, args: f.call.args }; yield { type: 'done' };
    } }, processor, f.sessions, f.toolDispatch);
    const pending = runtime.runAgentLoop(f.request);
    await f.started.promise; expect(f.execute).not.toHaveBeenCalled();
    expect(await f.repo.loadHistory('session')).toEqual([]);
    gate.resolve(); await pending;
    expect(f.order.indexOf('save:ack')).toBeLessThan(f.order.indexOf('execute')); expect(f.execute).toHaveBeenCalledTimes(1);
    const rows = await f.repo.loadHistory('session'); expect(rows.filter(row => row.role === 'assistant')).toHaveLength(1);
    expect(rows.find(row => row.id === 'assistant')?.toolCalls).toHaveLength(1);
  });
  it('does not launch when the actual assistant persistence ACK fails', async () => {
    const f = fixture({ fail: true }); await new ToolCallHandler().handle({ type: 'tool_call', callId: f.call.id, name: f.call.name, args: f.call.args }, f.context);
    await expect(f.dispatch(f.call)).rejects.toThrow('ASSISTANT_ACK_FAILED'); expect(f.execute).not.toHaveBeenCalled();
    expect(await f.repo.loadHistory('session')).toEqual([]);
  });
  it.each(['execution', 'failure'] as const)('blocks executor entry when %s stops during the ACK', async source => {
    const gate = deferred(); const f = fixture({ gate: gate.promise });
    const pending = f.dispatch(f.call); const rejected = expect(pending).rejects.toThrow('LAUNCH_PERSISTENCE_ABORTED');
    await f.started.promise; f[source].abort(); gate.resolve(); await rejected; expect(f.execute).not.toHaveBeenCalled();
  });
  it.each([false, true])('persists a once-transformed collected call with options=%s without duplicate rows', async native => {
    const f = fixture({ transform: true }); f.state.addToolCall(f.call);
    const options = native ? { abortSignal: new AbortController().signal } : undefined;
    const pending = f.dispatch(f.call, options); expect(f.dispatch(f.call, options)).toBe(pending); await pending;
    expect(f.transform).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.assistantWrites.mock.calls.filter(([row]) => row.role === 'assistant')).toHaveLength(1);
    const assistant = (await f.repo.loadHistory('session')).find(row => row.id === 'assistant');
    expect(assistant?.toolCalls).toEqual([{ id: 'effective', name: 'run_sub_agentflow', args: { goal: 'fixture', approved: 'host-transform' } }]);
  });
  it('leaves the ordinary non-launch no-options persistence timing unchanged', async () => {
    const f = fixture({ name: 'read_fixture' }); f.state.addToolCall(f.call); await f.dispatch(f.call);
    expect(f.execute).toHaveBeenCalledTimes(1); expect(f.assistantWrites.mock.calls.filter(([row]) => row.role === 'assistant')).toHaveLength(0);
  });
});
