import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { detachHostReceiptArgs } from '../../common/host-receipt-json';
import { hashGoalLaunchJson } from '../../common/goal-launch-canonical';
import type { PendingConfirmation } from './tool-confirmation-pending';
import { ToolConfirmationService } from './tool-confirmation.service';
import { awaitToolConfirmation } from './tool-confirmation-wait';
import { TurnState } from './turn-state';
import { DecisionAuthService, type DecisionAuthRequest } from '../../common/decision-auth.service';
import { GoalLaunchDecisionService, type GoalLaunchSnapshotPort } from '../hitl/goal-launch-decision.service';
import { reconcileCommittedGoalLaunchDecision, reconcileRegisteredGoalLaunchWaiter,
  type GoalLaunchReconciliationDependencies } from './tool-confirmation-reconciliation';

const clients: Database.Database[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); });
function fixture(status: 'approved' | 'denied' = 'approved') {
  const sqlite = new Database(':memory:'); clients.push(sqlite);
  sqlite.exec(`CREATE TABLE hitl_requests (
    id text PRIMARY KEY NOT NULL, kind text NOT NULL, status text NOT NULL,
    session_id text NOT NULL, turn_id text, run_id text, tool_call_id text,
    payload text NOT NULL, continuation text, outcome text, revision integer NOT NULL,
    created_at integer NOT NULL, updated_at integer NOT NULL, resolved_at integer
  );`);
  const database = new DrizzleService(null as never);
  (database as unknown as { db: unknown }).db = drizzle(sqlite, { schema });
  const requests = new HitlRequestService(database);
  const args = { flowId: 'flow', goal: 'Build home', context: { nested: ['original'] } };
  const disclosure = { schemaVersion: 1, kind: 'goal_launch', preset: { id: 'flow', name: 'Goal' }, goal: 'Build home',
    behavior: 'attempt_goal_continuation_until_review_or_blocked', approvalBoundary: 'confirmation_required_actions_remain_independent',
    disclosureId: 'abcdefghijklmnopqrstu' };
  const requirement = { kind: 'human_only', toolName: 'run_sub_agentflow', callId: 'call', goalLaunch: {
    schemaVersion: 1, parentWaitingRevision: 7, argsSha256: hashGoalLaunchJson(args), disclosureSha256: hashGoalLaunchJson(disclosure),
    parentRunId: 'run', parentSessionId: 'session', parentTurnId: 'turn', promptMessageId: 'prompt', assistantMessageId: 'assistant',
    flowDefinitionId: 'flow', schemaId: 'schema', policyId: 'policy', flowDefinitionSha256: 'a'.repeat(64),
    schemaDefinitionSha256: 'b'.repeat(64), policySha256: 'c'.repeat(64) } };
  const origin = { schemaVersion: 1, kind: 'decision_browser_goal_launch', authorityMode: 'browser_cookie',
    requestId: 'request', sessionId: 'session', toolCallId: 'call', disclosureId: disclosure.disclosureId, approvedFromRevision: 3 };
  const payload = { toolName: 'run_sub_agentflow', args, goalLaunchDisclosure: disclosure };
  const continuation = { version: 1, kind: 'approved_tool_then_resume_turn', phase: 'tool_pending', executionState: 'pending',
    runId: 'run', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt', messageId: 'assistant',
    hostConfirmationRequirement: requirement, ...(status === 'approved' ? { approvalOrigin: origin } : {}) };
  // Persisted readback fixtures, not a production browser-origin or launch producer.
  sqlite.prepare('INSERT INTO hitl_requests (id,kind,status,session_id,turn_id,run_id,tool_call_id,revision,payload,continuation,outcome,created_at,updated_at,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('request', 'tool_confirmation', status,
    'session', 'turn', 'run', 'call', 4, JSON.stringify(payload), JSON.stringify(continuation), null, 1, 2, 2);
  const controller = new AbortController();
  const events: string[] = [];
  const pending: PendingConfirmation = { sessionId: 'session', revision: 3,
    payload: { requestId: 'request', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt',
      toolCallId: 'call', toolName: 'run_sub_agentflow', args, timeoutMs: 0 }, emit: () => undefined,
    source: Object.freeze({ runId: 'run', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt',
      assistantMessageId: 'assistant', toolCallId: 'call', toolName: 'run_sub_agentflow', args: detachHostReceiptArgs(args), pendingRequestRevision: 3 }),
    sourceAbortSignal: controller.signal, resolve: () => events.push('approved'), reject: () => events.push('denied') };
  const deps: GoalLaunchReconciliationDependencies = { pending: new Map([['request', pending]]), requests,
    notifySettled: () => { expect(deps.pending.size).toBe(0); events.push('notify'); }, logFailure: vi.fn() };
  const selector = { requestId: 'request', sessionId: 'session', disclosureId: disclosure.disclosureId, committedRevision: 4 };
  const write = (p = payload, c: unknown = continuation) => sqlite.prepare('UPDATE hitl_requests SET payload=?,continuation=?')
    .run(JSON.stringify(p), JSON.stringify(c));
  return { sqlite, requests, pending, deps, selector, events, controller, payload, continuation, requirement, origin, write };
}

describe('committed goal launch waiter reconciliation (SQLite readbacks)', () => {
  it.each(['approved', 'denied'] as const)('settles %s before notification, once', async status => {
    const f = fixture(status);
    expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe('settled');
    expect(f.events).toEqual([status, 'notify']);
    expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe('not_live');
  });
  it('rejects a future disclosure and malformed private binding without asserting browser identity', async () => {
    const f = fixture('denied');
    f.write({ ...f.payload, goalLaunchDisclosure: { schemaVersion: 99, disclosureId: f.selector.disclosureId } } as typeof f.payload,
      { ...f.continuation, hostConfirmationRequirement: { kind: 'human_only', toolName: 'run_sub_agentflow', callId: 'call', goalLaunch: 'preparing' } });
    expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe('settled');
    expect(f.events).toEqual(['denied', 'notify']);
  });
  it.each(['run_id', 'session_id', 'turn_id', 'tool_call_id', 'revision', 'status', 'outcome'])('rejects durable mismatch %s', async field => {
    const f = fixture();
    f.sqlite.prepare(`UPDATE hitl_requests SET ${field}=?`).run(field === 'revision' ? 9 : field === 'outcome' ? '{"secret":true}' : 'foreign');
    expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe('conflict'); expect(f.events).toEqual([]);
  });
  it.each(['promptMessageId', 'messageId', 'executionState', 'hostExecutionCommit'])('rejects continuation mismatch %s', async key => {
    const f = fixture(); f.write(f.payload, { ...f.continuation, [key]: 'foreign' });
    expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe('conflict'); expect(f.events).toEqual([]);
  });
  it.each(['requestId', 'sessionId', 'disclosureId', 'approvedFromRevision', 'authorityMode', 'schemaVersion'])('rejects forged browser origin %s', async key => {
    const f = fixture(); f.write(f.payload, { ...f.continuation, approvalOrigin: { ...f.origin, [key]: key === 'approvedFromRevision' ? 1 : 'foreign' } });
    expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe('conflict');
  });
  it('rejects missing origin, future approved disclosure and changed args', async () => {
    for (const patch of ['origin', 'disclosure', 'args']) {
      const f = fixture();
      if (patch === 'origin') { const { approvalOrigin: _origin, ...cursor } = f.continuation; f.write(f.payload, cursor); }
      else if (patch === 'args') f.write({ ...f.payload, args: { ...f.payload.args, goal: 'forged' } });
      else f.write({ ...f.payload, goalLaunchDisclosure: { ...f.payload.goalLaunchDisclosure, schemaVersion: 99 } });
      expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe('conflict');
    }
  });
  it.each(['missing', 'replace', 'abort'])('rechecks live identity after durable read: %s', async mutation => {
    const f = fixture(); const read = f.requests.getById.bind(f.requests);
    vi.spyOn(f.requests, 'getById').mockImplementation(async id => {
      const row = await read(id);
      if (mutation === 'missing') f.deps.pending.delete('request');
      else if (mutation === 'replace') f.deps.pending.set('request', { ...f.pending });
      else f.controller.abort('private reason');
      return row;
    });
    expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe(mutation === 'abort' ? 'conflict' : 'not_live');
    expect(f.events).toEqual([]);
  });
  it('does not approve a pre-aborted waiter', async () => {
    const f = fixture(); f.controller.abort();
    expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe('conflict'); expect(f.events).toEqual([]);
  });
  it('settles even when notification throws', async () => {
    const f = fixture(); f.deps.notifySettled = () => { throw new Error('secret'); };
    expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe('settled'); expect(f.events).toEqual(['approved']);
    expect(f.deps.logFailure).toHaveBeenCalledWith();
  });
  it('fails closed on read failure and descriptor traps without invoking getters', async () => {
    const f = fixture(); const read = f.requests.getById.bind(f.requests); const getter = vi.fn(() => f.payload);
    vi.spyOn(f.requests, 'getById').mockImplementation(async id => Object.defineProperty((await read(id))!, 'payload', { get: getter }));
    expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe('conflict'); expect(getter).not.toHaveBeenCalled();
    vi.spyOn(f.requests, 'getById').mockRejectedValue(new Error('raw private data'));
    expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe('conflict'); expect(f.events).toEqual([]);
  });
  it('registration catches an already committed row using its actual revision', async () => {
    const f = fixture(); expect(await reconcileRegisteredGoalLaunchWaiter('request', f.deps)).toBe('settled');
    expect(f.events).toEqual(['approved', 'notify']);
  });
  it('skips a candidate with no private goal marker without notification', async () => {
    const f = fixture(); const { hostConfirmationRequirement: _marker, ...cursor } = f.continuation; f.write(f.payload, cursor);
    expect(await reconcileRegisteredGoalLaunchWaiter('request', f.deps)).toBe('not_live'); expect(f.events).toEqual([]);
    expect(f.deps.logFailure).not.toHaveBeenCalled();
  });
  it('skips seeded waiters before reading', async () => {
    const f = fixture(); const { source: _source, sourceAbortSignal: _signal, ...seed } = f.pending;
    f.deps.pending.set('request', seed); const read = vi.spyOn(f.requests, 'getById');
    expect(await reconcileRegisteredGoalLaunchWaiter('request', f.deps)).toBe('not_live'); expect(read).not.toHaveBeenCalled();
  });

  it.each(['approved', 'denied'] as const)('real wait registration catches commit before installation: %s', async status => {
    const f = fixture(status); f.deps.pending.clear();
    let requestId = '';
    const create = f.requests.create.bind(f.requests);
    vi.spyOn(f.requests, 'create').mockImplementation(async input => {
      const row = await create(input); requestId = row.id;
      // Fixture preparation final revision, read from SQLite, not inferred from journal revision.
      f.sqlite.prepare('UPDATE hitl_requests SET revision=3 WHERE id=?').run(row.id);
      return (await f.requests.getById(row.id))!;
    });
    const waiting = awaitToolConfirmation({ callId: 'call', toolName: 'run_sub_agentflow', args: f.payload.args,
      pending: f.deps.pending, hitlRequests: f.requests, hitlNotifications: null, runtimeAudit: null,
      logger: { warn: vi.fn(), error: vi.fn() }, emitConfirmationInvalidated: vi.fn(),
      logConfirmationLifecycle: vi.fn(), logRuntimeConfirmation: vi.fn(),
      onGoalWaitRegistered: id => reconcileRegisteredGoalLaunchWaiter(id, f.deps),
      ctx: { runId: 'run', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt', messageId: 'assistant',
        state: new TurnState(), abortSignal: f.controller.signal, emit: () => undefined,
        markWaitingForHuman: async () => {
          const cursor = { ...f.continuation, ...(status === 'approved' ? { approvalOrigin: { ...f.origin, requestId } } : {}) };
          f.sqlite.prepare('UPDATE hitl_requests SET status=?,revision=4,payload=?,continuation=?,resolved_at=2 WHERE id=?')
            .run(status, JSON.stringify(f.payload), JSON.stringify(cursor), requestId);
        } },
    });
    expect(await waiting).toEqual({ requestId, status: status === 'approved' ? 'approved' : 'rejected' });
    expect(f.deps.pending.size).toBe(0);
  });

  it('service delegates settlement before a throwing emitted notification', async () => {
    const f = fixture();
    const service = new ToolConfirmationService(null, null, null, f.requests);
    Reflect.set(service, 'pending', f.deps.pending);
    f.pending.emit = () => { throw new Error('private notification failure'); };
    expect(await service.reconcileCommittedGoalLaunchDecision(f.selector)).toBe('settled');
    expect(f.events).toEqual(['approved']);
    expect(f.deps.pending.size).toBe(0);
  });

  it('denied rows with an origin or malformed envelope never settle', async () => {
    for (const mutation of ['origin', 'envelope']) {
      const f = fixture('denied');
      if (mutation === 'origin') f.write(f.payload, { ...f.continuation, approvalOrigin: f.origin });
      else f.write({ ...f.payload, goalLaunchDisclosure: { ...f.payload.goalLaunchDisclosure, schemaVersion: 0 } });
      expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe('conflict');
      expect(f.events).toEqual([]);
    }
  });

  it('registration pending/non-goal rows are quiet and never rewrite revisions', async () => {
    const f = fixture(); f.sqlite.prepare("UPDATE hitl_requests SET status='pending',revision=3,resolved_at=NULL").run();
    expect(await reconcileRegisteredGoalLaunchWaiter('request', f.deps)).toBe('not_live');
    expect(f.events).toEqual([]); expect(f.deps.logFailure).not.toHaveBeenCalled();
  });

  it('selector getters/proxies never execute', async () => {
    const f = fixture(); const getter = vi.fn(() => 'request');
    const value = Object.defineProperty({ ...f.selector }, 'requestId', { get: getter });
    expect(await reconcileCommittedGoalLaunchDecision(value, f.deps)).toBe('conflict');
    const proxy = new Proxy(f.selector, { ownKeys: getter });
    expect(await reconcileCommittedGoalLaunchDecision(proxy, f.deps)).toBe('conflict');
    expect(getter).not.toHaveBeenCalled();
  });
  it.each(['requestId', 'sessionId', 'toolCallId', 'toolName', 'turnId', 'promptMessageId'])('rejects mutable waiter notification identity drift: %s', async key => {
    const f = fixture(); Reflect.set(f.pending.payload, key, 'foreign');
    expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe('conflict');
    expect(f.events).toEqual([]); expect(f.deps.pending.get('request')).toBe(f.pending);
  });
  it('rechecks notification identity when payload changes during the durable read', async () => {
    const f = fixture(); const read = f.requests.getById.bind(f.requests);
    vi.spyOn(f.requests, 'getById').mockImplementation(async id => {
      const row = await read(id); f.pending.payload.requestId = 'foreign'; return row;
    });
    expect(await reconcileCommittedGoalLaunchDecision(f.selector, f.deps)).toBe('conflict');
    expect(f.events).toEqual([]);
  });
  it('concurrent registration and decision callbacks settle one live waiter', async () => {
    const f = fixture();
    const results = await Promise.all([reconcileRegisteredGoalLaunchWaiter('request', f.deps),
      reconcileCommittedGoalLaunchDecision(f.selector, f.deps)]);
    expect(results.sort()).toEqual(['not_live', 'settled']);
    expect(f.events).toEqual(['approved', 'notify']);
  });
});

function composedFixture() {
  const f = fixture();
  const definitions = { flowDefinition: { id: 'flow', nodes: ['worker', 'judge'] },
    schemaDefinition: { id: 'schema', version: 1 }, policy: { id: 'policy', humanOnly: true } };
  const requirement = { ...f.requirement, goalLaunch: { ...f.requirement.goalLaunch,
    flowDefinitionSha256: hashGoalLaunchJson(definitions.flowDefinition),
    schemaDefinitionSha256: hashGoalLaunchJson(definitions.schemaDefinition), policySha256: hashGoalLaunchJson(definitions.policy) } };
  const { approvalOrigin: _origin, ...cursor } = f.continuation;
  f.write(f.payload, { ...cursor, hostConfirmationRequirement: requirement });
  f.sqlite.prepare("UPDATE hitl_requests SET status='pending',revision=3,resolved_at=NULL").run();
  f.sqlite.exec(`CREATE TABLE chat_runs (id TEXT PRIMARY KEY,session_id TEXT,turn_id TEXT,revision INTEGER,status TEXT,phase TEXT,completed_at INTEGER);
    CREATE TABLE messages (id TEXT PRIMARY KEY,session_id TEXT,turn_id TEXT,prompt_message_id TEXT,role TEXT,tool_calls TEXT);
    INSERT INTO chat_runs VALUES ('run','session','turn',7,'waiting_for_human','tool_pending',NULL);
    INSERT INTO messages VALUES ('prompt','session','turn',NULL,'user',NULL);`);
  f.sqlite.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?)').run('assistant', 'session', 'turn', 'prompt', 'assistant',
    JSON.stringify([{ id: 'call', name: 'run_sub_agentflow', args: f.payload.args }]));
  const auth = new DecisionAuthService({ PORT: '3316', KALIO_CONTROL_PLANE_TOKEN: 'a'.repeat(64) });
  const browser: DecisionAuthRequest = { ip: '127.0.0.1', method: 'POST', headers: {
    host: 'localhost:5288', origin: 'http://localhost:5288', 'content-type': 'application/json' } };
  browser.headers.cookie = `${auth.cookieName}=${auth.createSession(browser)}`;
  browser.method = 'PUT';
  const readCurrent = vi.fn<GoalLaunchSnapshotPort['readCurrent']>(async () => ({ status: 'eligible',
    flowDefinitionId: 'flow', schemaId: 'schema', policyId: 'policy', ...structuredClone(definitions) }));
  const decision = new GoalLaunchDecisionService(drizzle(f.sqlite, { schema }), auth, { readCurrent });
  const body = { requestId: 'request', sessionId: 'session', disclosureId: f.selector.disclosureId };
  return { ...f, decision, body, browser, readCurrent };
}

describe('actual browser decision → durable SQLite → live waiter composition', () => {
  it.each(['approve', 'reject'] as const)('uses actual %s result without minting origin in reconciliation', async action => {
    const f = composedFixture();
    const result = await f.decision.decide({ ...f.body, decision: action, message: 'reviewed' }, f.browser, f.controller.signal);
    const row = await f.requests.getById(result.requestId);
    expect(row?.revision).toBe(4);
    if (action === 'approve') expect(row?.continuation?.['approvalOrigin']).toMatchObject({
      kind: 'decision_browser_goal_launch', approvedFromRevision: 3, requestId: 'request' });
    else expect(row?.continuation).not.toHaveProperty('approvalOrigin');
    // Real Promise settlers, like the owning wait closures: never arbitrary throwing callbacks.
    let settle!: (status: string) => void;
    const waiting = new Promise<string>(resolve => { settle = resolve; });
    f.pending.resolve = () => { f.events.push('approved'); settle('approved'); };
    f.pending.reject = () => { f.events.push('denied'); settle('denied'); };
    f.deps.notifySettled = () => { throw new Error('private notification failure'); };
    const selector = { requestId: result.requestId, sessionId: result.sessionId,
      disclosureId: result.disclosureId, committedRevision: result.revision };
    expect(await reconcileCommittedGoalLaunchDecision(selector, f.deps)).toBe('settled');
    expect(await waiting).toBe(action === 'approve' ? 'approved' : 'denied');
    expect(f.deps.pending.size).toBe(0);
    expect(f.sqlite.prepare('SELECT status,revision FROM chat_runs').get()).toEqual({ status: 'waiting_for_human', revision: 7 });
  });

  it('Stop during actual snapshot review prevents commit and never settles approval', async () => {
    const f = composedFixture(); const read = f.readCurrent.getMockImplementation()!;
    f.readCurrent.mockImplementation(async (...args) => {
      const snapshot = await read(...args); f.controller.abort('private Stop reason'); return snapshot;
    });
    await expect(f.decision.decide({ ...f.body, decision: 'approve' }, f.browser, f.controller.signal))
      .rejects.toThrow('GOAL_LAUNCH_DECISION_ABORTED');
    const row = await f.requests.getById('request');
    expect(row?.status).toBe('pending'); expect(row?.revision).toBe(3);
    expect(row?.continuation).not.toHaveProperty('approvalOrigin');
    expect(await reconcileRegisteredGoalLaunchWaiter('request', f.deps)).toBe('conflict');
    expect(f.events).toEqual([]); expect(f.deps.pending.get('request')).toBe(f.pending);
  });

  it('Stop during durable reconciliation read cannot approve an actual committed decision', async () => {
    const f = composedFixture();
    const result = await f.decision.decide({ ...f.body, decision: 'approve' }, f.browser, f.controller.signal);
    const read = f.requests.getById.bind(f.requests);
    vi.spyOn(f.requests, 'getById').mockImplementation(async id => {
      const row = await read(id); f.controller.abort('private Stop reason'); return row;
    });
    expect(await reconcileCommittedGoalLaunchDecision({ requestId: result.requestId, sessionId: result.sessionId,
      disclosureId: result.disclosureId, committedRevision: result.revision }, f.deps)).toBe('conflict');
    expect(f.events).toEqual([]); expect(f.deps.pending.get('request')).toBe(f.pending);
    // Owning abort settlement is not fabricated by this helper.
  });
});
