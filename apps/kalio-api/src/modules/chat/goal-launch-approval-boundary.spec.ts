import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, expect, it, vi } from 'vitest';
import type { LLMToolCall } from '@kalio/types';
import * as schema from '../../database/schema';
import type { DrizzleService } from '../../database/drizzle.service';
import { readPersistedGoalLaunchCalls } from '../../common/goal-launch-persisted-call';
import { DrizzleMessageRepository } from './drizzle-message.repository';
import { SessionEventsService } from './session-events.service';
import { createMessageSessions } from './__tests__/message-session.fixture';
import { SessionManagerService } from './session-manager.service';
import { RunJournalService } from './run-journal.service';
import { runCheckpoint } from './chat-input.helpers';
import { ToolDispatchService } from './tool-dispatch.service';
import { ToolConfirmationService } from './tool-confirmation.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { LLMTurnRuntimeService } from './llm-turn-runtime.service';
import { StreamProcessorService } from './stream-processor.service';
import { ToolCallHandler } from './handlers/tool-call.handler';
import { DoneHandler } from './handlers/done.handler';

const clients: Database.Database[] = [];
afterEach(() => { vi.restoreAllMocks(); clients.splice(0).forEach(client => client.close()); });
type JournalObservation = { id: string; status: string; phase: string; revision: number; completedAt: number | null };
type AssistantObservation = { id: string; sessionId: string; turnId: string; promptMessageId: string; toolCalls: string; bytes: Uint8Array };

async function fixture(duplicate: boolean) {
  const client = new Database(':memory:'); clients.push(client);
  createMessageSessions(client, ['session']);
  // Same SQLite columns as the existing journal/message persistence fixtures;
  // lifecycle values are written only by the actual RunJournalService.
  client.exec(`CREATE TABLE chat_runs (
    id TEXT PRIMARY KEY,session_id TEXT,turn_id TEXT,phase TEXT,status TEXT,provider TEXT,model TEXT,runtime_kind TEXT,
    execution_profile_id TEXT,external_thread_id TEXT,external_turn_id TEXT,process_epoch TEXT,revision INTEGER DEFAULT 1,
    retry_count INTEGER DEFAULT 0,safe_resume INTEGER DEFAULT 0,error_code TEXT,error_message TEXT,queue_idempotency_key TEXT,
    queued_payload TEXT,queued_at INTEGER,queue_claimed_at INTEGER,queue_cancelled_at INTEGER,outcome TEXT,
    started_at INTEGER,updated_at INTEGER,last_heartbeat_at INTEGER,completed_at INTEGER);
    CREATE TABLE messages (id TEXT PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,turn_id TEXT,prompt_message_id TEXT,
    thinking TEXT,tool_calls TEXT,tool_call_id TEXT,attachments TEXT,created_at INTEGER);
    CREATE TABLE hitl_requests (id TEXT PRIMARY KEY,kind TEXT,status TEXT DEFAULT 'pending',session_id TEXT,turn_id TEXT,
    run_id TEXT,tool_call_id TEXT,payload TEXT,continuation TEXT,outcome TEXT,revision INTEGER DEFAULT 1,
    created_at INTEGER,updated_at INTEGER,resolved_at INTEGER);`);
  const provider = { db: drizzle(client, { schema }) } as unknown as DrizzleService;
  const journal = new RunJournalService(provider);
  const started = await journal.startRun({ sessionId:'session',turnId:'turn',runtimeKind:'chat' });
  const checkpoint = runCheckpoint(journal, started.id);
  const repository = new DrizzleMessageRepository(provider, new SessionEventsService());
  await repository.saveMessage({ id:'prompt',sessionId:'session',turnId:'turn',role:'user',content:'fixture goal',createdAt:Date.now() });
  const call: LLMToolCall = { id:'call',name:'run_sub_agentflow',args:{flowId:'fixture',goal:'fixture goal'} };
  if (duplicate) await repository.saveMessage({ id:'other-assistant',sessionId:'session',turnId:'turn',promptMessageId:'prompt',
    role:'assistant',content:'',toolCalls:[call],createdAt:Date.now() });
  const sessions = new SessionManagerService(repository, {} as never,
    { getContextWindowSize:async () => 32_000 } as never, journal);
  const requests = new HitlRequestService(provider);
  const confirmation = new ToolConfirmationService(null, null, null, requests);
  const execute = vi.fn(async () => ({ fixture:true }));
  const dispatch = new ToolDispatchService([{meta:{name:'run_sub_agentflow',description:'fixture',parameters:{},requiresConfirmation:true},execute}],
    null,null,null,null,confirmation);
  const readJournal = (): JournalObservation => client.prepare(`SELECT id,status,phase,revision,completed_at AS completedAt
    FROM chat_runs WHERE id=? AND session_id=? AND turn_id=?`).get(started.id,'session','turn') as JournalObservation;
  const observations: Array<{ journal:JournalObservation; assistants:AssistantObservation[]; occurrences:number }> = [];
  const original = confirmation.approveOrRequestConfirmation.bind(confirmation);
  vi.spyOn(confirmation,'approveOrRequestConfirmation').mockImplementation(async (...args) => {
    const assistants = client.prepare(`SELECT id,session_id AS sessionId,turn_id AS turnId,prompt_message_id AS promptMessageId,
      tool_calls AS toolCalls,CAST(tool_calls AS BLOB) AS bytes FROM messages
      WHERE session_id=? AND turn_id=? AND prompt_message_id=? AND role='assistant'`).all('session','turn','prompt') as AssistantObservation[];
    const occurrences = assistants.flatMap(row => readPersistedGoalLaunchCalls(row.toolCalls,row.bytes)).filter(item => item.id === call.id).length;
    observations.push({journal:readJournal(),assistants,occurrences});
    return original(...args);
  });
  const waiting: JournalObservation[] = [];
  const running = vi.fn(async () => { await checkpoint('tool_running',{status:'active'}); });
  const processor = new StreamProcessorService([new ToolCallHandler(),new DoneHandler(sessions)],[]); processor.onModuleInit();
  const runtime = new LLMTurnRuntimeService({async *stream() {
    yield {type:'tool_call',callId:call.id,name:call.name,args:call.args}; yield {type:'done'};
  }},processor,sessions,dispatch);
  const promise = runtime.runAgentLoop({runId:started.id,sessionId:'session',turnId:'turn',promptMessageId:'prompt',firstMessageId:'assistant',
    runtimeKind:'chat',personaId:'fixture',effectiveSystemPrompt:'fixture',maxIterations:1,providerCompletesTurn:true,
    toolMetas:dispatch.getToolMetas(),abortSignal:new AbortController().signal,emit:vi.fn(),callbacks:{
      // Exact journal callback operations used by ChatService; no phase seed or mock checkpoint.
      onBeforeIteration:async () => { await checkpoint('llm_streaming'); },
      onToolPending:async () => { await checkpoint('tool_pending'); },
      onWaitingForHuman:async () => { await checkpoint('tool_pending',{status:'waiting_for_human'}); waiting.push(readJournal()); },
      onToolRunning:running,
    }});
  try {
    await vi.waitFor(() => { expect(waiting).toHaveLength(1); expect(confirmation.getPendingConfirmations('session')).toHaveLength(1); });
  } catch (error) {
    const pending = confirmation.getPendingConfirmations('session')[0];
    if (pending) await confirmation.cancelConfirmation(pending.requestId,'session');
    await promise;
    throw error;
  }
  const pending = confirmation.getPendingConfirmations('session')[0]!;
  console.info('GOAL_LAUNCH_BOUNDARY_OBSERVATION', {
    duplicateFixture:duplicate,
    before:observations.map(item => ({status:item.journal.status,phase:item.journal.phase,revision:item.journal.revision,callOccurrences:item.occurrences})),
    waiting:waiting.map(item => ({status:item.status,phase:item.phase,revision:item.revision})),
  });
  expect(await confirmation.cancelConfirmation(pending.requestId,'session')).toBe('rejected');
  await promise;
  return {started,observations,waiting,running,execute,client,pending};
}

it('observes actual active/tool_pending at approval entry and actual paused revision afterward', async () => {
  const f = await fixture(false);
  expect(f.observations).toHaveLength(1);
  const before = f.observations[0]!;
  expect(before.journal).toMatchObject({id:f.started.id,status:'active',phase:'tool_pending',completedAt:null});
  expect(Number.isSafeInteger(before.journal.revision)).toBe(true);
  expect(before.occurrences).toBe(1);
  expect(before.assistants).toHaveLength(1);
  expect(before.assistants[0]).toMatchObject({id:'assistant',sessionId:'session',turnId:'turn',promptMessageId:'prompt'});
  expect(readPersistedGoalLaunchCalls(before.assistants[0]!.toolCalls,before.assistants[0]!.bytes)).toEqual([
    {id:'call',name:'run_sub_agentflow',args:{flowId:'fixture',goal:'fixture goal'}},
  ]);
  expect(f.waiting[0]).toMatchObject({id:f.started.id,status:'waiting_for_human',phase:'tool_pending',completedAt:null});
  // No inferred +1 contract: both revisions are actual exact-ID SQLite observations.
  expect(f.waiting[0]!.revision).toBeGreaterThan(before.journal.revision);
  expect(f.running).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  expect(f.client.prepare('SELECT status FROM hitl_requests WHERE id=?').get(f.pending.requestId)).toEqual({status:'cancelled'});
});
it('observes that a foreign persisted duplicate defeats uniqueness despite the ACK ordering', async () => {
  const f = await fixture(true); const before = f.observations[0]!;
  expect(before.journal).toMatchObject({status:'active',phase:'tool_pending'});
  expect(before.occurrences).toBe(2);
  expect(before.assistants.map(row => row.id).sort()).toEqual(['assistant','other-assistant']);
  expect(f.waiting[0]).toMatchObject({status:'waiting_for_human',phase:'tool_pending'});
  expect(f.execute).not.toHaveBeenCalled();
  // This is an observation, not a claim that generic dispatch enforces source uniqueness.
});
