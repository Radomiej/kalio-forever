import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../database/schema';
import { DrizzleService } from '../../../database/drizzle.service';
import { DrizzleMessageRepository } from '../drizzle-message.repository';
import { SessionEventsService } from '../session-events.service';
import { createMessageSessions } from './message-session.fixture';
import { HitlRequestService } from '../../hitl/hitl-request.service';
import { ToolConfirmationService } from '../tool-confirmation.service';
import type { ChatMessage, LLMToolCall } from '@kalio/types';
import type { ILLMSource, LLMSourceParams } from '../interfaces/llm-source.interface';
import type { EmitFn } from '../interfaces/stream-context.interface';
import { SessionManagerService } from '../session-manager.service';
import { LLMTurnRuntimeService } from '../llm-turn-runtime.service';
import { StreamProcessorService } from '../stream-processor.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import { DoneHandler } from '../handlers/done.handler';
import { TextDeltaHandler } from '../handlers/text-delta.handler';

const databases: Database.Database[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function fixture(options?: { earlyDone?: boolean; failSaveRole?: ChatMessage['role']; failRunningCheckpoint?: boolean; runningGate?: Promise<void> }) {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  sqlite.exec(`CREATE TABLE messages (
    id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
    turn_id TEXT, prompt_message_id TEXT, thinking TEXT, tool_calls TEXT, tool_call_id TEXT,
    attachments TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE hitl_requests (
    id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    session_id TEXT NOT NULL, turn_id TEXT, run_id TEXT, tool_call_id TEXT,
    payload TEXT NOT NULL, continuation TEXT, outcome TEXT, revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, resolved_at INTEGER
  );`);
  const database = new DrizzleService(null as never);
  (database as unknown as { db: unknown }).db = drizzle(sqlite, { schema });
  createMessageSessions(sqlite, ['native-session']);
  const repo = new DrizzleMessageRepository(database, new SessionEventsService());
  const hitl = new HitlRequestService(database);
  const confirmations = new ToolConfirmationService(null, null, null, hitl);
  const saveMessage = repo.saveMessage.bind(repo);
  repo.saveMessage = async (message) => {
    if (message.role === options?.failSaveRole) throw new Error(`Cannot persist ${message.role}`);
    await saveMessage(message);
  };
  const sessions = new SessionManagerService(repo, {} as never,
    { getContextWindowSize: async () => 32_000 } as never,
    { getNonReplayableTurnIds: async () => new Set() } as never);
  const processor = new StreamProcessorService([new DoneHandler(sessions), new TextDeltaHandler()], []);
  processor.onModuleInit();
  let writes = 0;
  let executingState = '';
  let lifecycle = '';
  const dispatcher = new ToolDispatchService([{
    meta: { name: 'fs_write', description: 'Write fixture', parameters: { type: 'object' }, requiresConfirmation: true },
    execute: async () => {
      executingState = lifecycle;
      writes++;
      return { written: true };
    },
  }], null, null, null, null, confirmations);
  let ready!: () => void;
  const pending = new Promise<void>((resolve) => { ready = resolve; });
  let readyRunning!: () => void;
  const running = new Promise<void>((resolve) => { readyRunning = resolve; });
  let readyProviderDone!: () => void;
  const providerDone = new Promise<void>((resolve) => { readyProviderDone = resolve; });
  const parent = new AbortController();
  const transport = new AbortController();
  let requestId = '';
  const events: Array<{ event: string; data: unknown }> = [];
  const runtimeEvents: Array<{ eventName: string }> = [];
  const emit: EmitFn = (event, data) => {
    events.push({ event, data });
    if (event === 'tool:confirmation_required') {
      requestId = (data as { requestId: string }).requestId;
      ready();
    }
  };
  const call: LLMToolCall = { id: 'mcp-call', name: 'fs_write', args: { path: 'fixture.css', content: 'demo' } };
  let received: LLMSourceParams | undefined;
  const source: ILLMSource = {
    async *stream(params) {
      received = params;
      const port = params.dispatchNativeTool;
      if (!port) throw new Error('Native tool execution has no durable runtime port');
      const first = port(call, { abortSignal: transport.signal });
      const duplicate = port(call, { abortSignal: transport.signal });
      if (options?.earlyDone) {
        yield { type: 'text_delta', delta: 'Provider finished while approval is pending' };
        yield { type: 'done' };
        readyProviderDone();
        return;
      }
      const [result, sameResult] = await Promise.all([first, duplicate]);
      expect(sameResult).toEqual(result);
      yield { type: 'text_delta', delta: result.status === 'success' ? 'Saved' : 'Cancelled' };
      yield { type: 'done' };
    },
  };
  const runtime = new LLMTurnRuntimeService(source, processor, sessions, dispatcher, undefined,
    { log: async (event: { eventName: string }) => { runtimeEvents.push(event); } } as never);
  const run = () => runtime.runAgentLoop({
    runtimeKind: 'chat', sessionId: 'native-session', runId: 'native-run', turnId: 'native-turn',
    promptMessageId: 'native-prompt', firstMessageId: 'native-assistant', personaId: 'persona',
    effectiveSystemPrompt: 'Use Kalio tools', toolMetas: dispatcher.getToolMetas(),
    abortSignal: parent.signal, emit, maxIterations: 1, providerCompletesTurn: true,
    callbacks: {
      onToolPending: async () => { lifecycle = 'tool_pending'; },
      onWaitingForHuman: async () => { lifecycle = 'waiting_for_human'; },
      onToolRunning: async () => {
        readyRunning();
        await options?.runningGate;
        if (options?.failRunningCheckpoint) throw new Error('Cannot persist running checkpoint');
        lifecycle = 'tool_running';
      },
    },
  });
  return { repo, hitl, dispatcher, parent, transport, pending, running, providerDone, run, events, runtimeEvents,
    get requestId() { return requestId; }, get writes() { return writes; },
    get lifecycle() { return lifecycle; }, get executingState() { return executingState; },
    get received() { return received; } };
}

describe('native Kalio tool lifecycle through the chat runtime', () => {
  it('drains an execution after provider completion without overwriting its call with streamed text', async () => {
    const f = fixture({ earlyDone: true });
    let settled = false;
    const run = f.run().then((result) => { settled = true; return result; });
    await Promise.race([f.pending, run]);
    await Promise.race([f.providerDone, run]);
    expect(settled).toBe(false);
    expect((await f.repo.loadHistory('native-session')).find((message) => message.id === 'native-assistant')).toMatchObject({ toolCalls: [{ id: 'mcp-call' }] });
    await f.dispatcher.resolveConfirmation(f.requestId, 'native-session');
    await run;
    expect(f.writes).toBe(1);
    expect((await f.repo.loadHistory('native-session')).find((message) => message.id === 'native-assistant')).toMatchObject({
      content: 'Provider finished while approval is pending', toolCalls: [{ id: 'mcp-call' }],
    });
    expect((await f.repo.loadHistory('native-session')).filter((message) => message.role === 'tool_result')).toHaveLength(1);
  });

  it.each(['parent', 'transport'] as const)('does not execute when %s aborts during the running checkpoint', async (source) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const f = fixture({ runningGate: gate });
    const run = f.run();
    await Promise.race([f.pending, run]);
    await f.dispatcher.resolveConfirmation(f.requestId, 'native-session');
    await Promise.race([f.running, run]);
    (source === 'parent' ? f.parent : f.transport).abort();
    release();
    await expect(run).resolves.toMatchObject({ aborted: source === 'parent' });
    expect(f.writes).toBe(0);
    const results = (await f.repo.loadHistory('native-session')).filter((message) => message.role === 'tool_result');
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0]!.content)).toMatchObject({ status: 'cancelled' });
    expect((await f.hitl.getById(f.requestId))?.continuation).toMatchObject({ executionState: 'tool_result_committed' });
  });

  it('does not execute when the assistant call cannot be persisted', async () => {
    const f = fixture({ failSaveRole: 'assistant' });
    await expect(f.run()).rejects.toThrow('Cannot persist assistant');
    expect(f.writes).toBe(0);
    expect(f.events.filter(({ event }) => event === 'tool:start')).toEqual([]);
  });

  it('does not execute when the running checkpoint cannot be persisted', async () => {
    const f = fixture({ failRunningCheckpoint: true });
    const run = f.run();
    await Promise.race([f.pending, run]);
    await f.dispatcher.resolveConfirmation(f.requestId, 'native-session');
    await expect(run).rejects.toThrow('Cannot persist running checkpoint');
    expect(f.writes).toBe(0);
  });

  it('does not retry or emit success when result persistence fails after a write', async () => {
    const f = fixture({ failSaveRole: 'tool_result' });
    const run = f.run();
    await Promise.race([f.pending, run]);
    await f.dispatcher.resolveConfirmation(f.requestId, 'native-session');
    await expect(run).rejects.toThrow('Cannot persist tool_result');
    expect(f.writes).toBe(1);
    expect(f.events.filter(({ event }) => event === 'tool:result')).toEqual([]);
    expect(f.runtimeEvents.some(({ eventName }) => eventName === 'llm.turn.failed')).toBe(true);
    const claimed = await f.hitl.getById(f.requestId);
    expect(claimed?.continuation).toMatchObject({ executionState: 'claimed' });
    expect(await f.hitl.claimApprovedContinuation(claimed!.id, claimed!.revision)).toBeNull();
  });

  it('persists a linked call before approval, executes once and restores its result', async () => {
    const f = fixture();
    const run = f.run();
    await Promise.race([f.pending, run]);
    expect(f.lifecycle).toBe('waiting_for_human');
    expect(f.writes).toBe(0);
    expect((await f.repo.loadHistory('native-session')).find((message) => message.id === 'native-assistant')).toMatchObject({
      role: 'assistant', turnId: 'native-turn', promptMessageId: 'native-prompt',
      toolCalls: [{ id: 'mcp-call', name: 'fs_write' }],
    });
    expect(f.received).toMatchObject({ turnId: 'native-turn', promptMessageId: 'native-prompt' });
    await f.dispatcher.resolveConfirmation(f.requestId, 'native-session');
    await expect(run).resolves.toMatchObject({ finalText: 'Saved', aborted: false });
    expect(f.writes).toBe(1);
    expect(f.executingState).toBe('tool_running');
    expect((await f.hitl.getById(f.requestId))?.continuation).toMatchObject({ executionState: 'tool_result_committed' });
    const restored = await f.repo.loadHistory('native-session');
    expect(restored.filter((message) => message.role === 'tool_result')).toEqual([
      expect.objectContaining({ toolCallId: 'mcp-call', turnId: 'native-turn', promptMessageId: 'native-prompt', content: '{"written":true}' }),
    ]);
    expect(restored.find((message) => message.role === 'assistant')).toMatchObject({ content: 'Saved', toolCalls: [{ id: 'mcp-call' }] });
    expect(f.events.filter(({ event }) => event === 'tool:start')).toHaveLength(1);
    expect(f.events.filter(({ event }) => event === 'tool:result')).toHaveLength(1);
    const messageCount = (await f.repo.loadHistory('native-session')).length;
    await expect(f.received!.dispatchNativeTool!(
      { id: 'late-call', name: 'fs_write', args: { path: 'late.css' } },
      { abortSignal: AbortSignal.abort() },
    )).rejects.toThrow('no longer accepts');
    expect(f.writes).toBe(1);
    expect((await f.repo.loadHistory('native-session')).length).toBe(messageCount);
  });

  it.each(['deny', 'transport_abort', 'parent_stop'] as const)('persists cancellation without a write after %s', async (decision) => {
    const f = fixture();
    const run = f.run();
    await Promise.race([f.pending, run]);
    if (decision === 'deny') await f.dispatcher.cancelConfirmation(f.requestId, 'native-session');
    else if (decision === 'transport_abort') f.transport.abort();
    else f.parent.abort();
    await run;
    expect(f.writes).toBe(0);
    expect(f.dispatcher.getPendingConfirmations('native-session')).toEqual([]);
    const results = (await f.repo.loadHistory('native-session')).filter((message) => message.role === 'tool_result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ turnId: 'native-turn', promptMessageId: 'native-prompt' });
    expect(JSON.parse(results[0]!.content)).toMatchObject({ status: 'cancelled' });
    expect(await f.dispatcher.resolveConfirmation(f.requestId, 'native-session')).toBe('not_found');
  });
});
