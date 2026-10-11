import 'reflect-metadata';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalLaunchDisclosureV1, GoalLaunchHostRequirement } from '@kalio/types';
import { BadRequestException, ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as schema from '../../database/schema';
import { DecisionAuthService, type DecisionAuthRequest } from '../../common/decision-auth.service';
import { hashGoalLaunchJson } from '../../common/goal-launch-canonical';
import { GoalLaunchDecisionService, type GoalLaunchSnapshotPort } from './goal-launch-decision.service';

const clients: Database.Database[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); });
function fixture() {
  const client = new Database(':memory:'); clients.push(client);
  client.exec(`CREATE TABLE hitl_requests (id TEXT PRIMARY KEY,kind TEXT,status TEXT,session_id TEXT,run_id TEXT,turn_id TEXT,
    tool_call_id TEXT,revision INTEGER,payload TEXT,continuation TEXT,outcome TEXT,created_at INTEGER,updated_at INTEGER,resolved_at INTEGER);
    CREATE TABLE chat_runs (id TEXT PRIMARY KEY,session_id TEXT,turn_id TEXT,revision INTEGER,status TEXT,phase TEXT,completed_at INTEGER);
    CREATE TABLE messages (id TEXT PRIMARY KEY,session_id TEXT,turn_id TEXT,prompt_message_id TEXT,role TEXT,tool_calls TEXT);`);
  const definitions = { flowDefinition: { id: 'flow', nodes: ['worker', 'judge'] }, schemaDefinition: { id: 'schema', version: 1 }, policy: { id: 'policy', humanOnly: true } };
  const disclosure: GoalLaunchDisclosureV1 = { schemaVersion: 1, kind: 'goal_launch', preset: { id: 'flow', name: 'Goal' },
    goal: ' Build Żółć 😀\n', behavior: 'attempt_goal_continuation_until_review_or_blocked',
    approvalBoundary: 'confirmation_required_actions_remain_independent', disclosureId: 'abcdefghijklmnopqrstu' };
  const args = { flowId: 'flow', goal: disclosure.goal, context: { b: 2, a: 1 } };
  const requirement: GoalLaunchHostRequirement = { kind: 'human_only', toolName: 'run_sub_agentflow', callId: 'call', goalLaunch: {
    schemaVersion: 1, parentWaitingRevision: 7, disclosureSha256: hashGoalLaunchJson(disclosure), argsSha256: hashGoalLaunchJson(args),
    parentRunId: 'run', parentSessionId: 'session', parentTurnId: 'turn', promptMessageId: 'prompt', assistantMessageId: 'assistant',
    flowDefinitionId: 'flow', schemaId: 'schema', policyId: 'policy', flowDefinitionSha256: hashGoalLaunchJson(definitions.flowDefinition),
    schemaDefinitionSha256: hashGoalLaunchJson(definitions.schemaDefinition), policySha256: hashGoalLaunchJson(definitions.policy) } };
  const payload = { toolName: 'run_sub_agentflow', args, goalLaunchDisclosure: disclosure };
  const continuation = { version: 1, kind: 'approved_tool_then_resume_turn', phase: 'tool_pending', executionState: 'pending',
    runId: 'run', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt', messageId: 'assistant', hostConfirmationRequirement: requirement };
  client.prepare('INSERT INTO hitl_requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('request', 'tool_confirmation', 'pending', 'session', 'run', 'turn', 'call', 3,
    JSON.stringify(payload), JSON.stringify(continuation), null, 1, 1, null);
  client.exec("INSERT INTO chat_runs VALUES ('run','session','turn',7,'waiting_for_human','tool_pending',NULL); INSERT INTO messages VALUES ('prompt','session','turn',NULL,'user',NULL)");
  client.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?)').run('assistant', 'session', 'turn', 'prompt', 'assistant', JSON.stringify([{ id: 'call', name: 'run_sub_agentflow', args }]));
  const db = drizzle(client, { schema }); let now = 1000;
  const auth = new DecisionAuthService({ PORT: '3316', KALIO_CONTROL_PLANE_TOKEN: 'a'.repeat(64) }, () => now);
  const browser: DecisionAuthRequest = { ip: '127.0.0.1', method: 'POST', headers: { host: 'localhost:5288', origin: 'http://localhost:5288', 'content-type': 'application/json' } };
  browser.headers.cookie = `${auth.cookieName}=${auth.createSession(browser)}`; browser.method = 'PUT';
  // Snapshot fixture only: production definition reader/factory is not wired here.
  const readCurrent = vi.fn<GoalLaunchSnapshotPort['readCurrent']>(async () => {
    expect(client.inTransaction).toBe(false);
    return { status: 'eligible', flowDefinitionId: 'flow', schemaId: 'schema', policyId: 'policy', ...structuredClone(definitions) };
  });
  const service = new GoalLaunchDecisionService(db, auth, { readCurrent });
  const body = { requestId: 'request', sessionId: 'session', disclosureId: disclosure.disclosureId, decision: 'approve' as const };
  const row = () => client.prepare('SELECT * FROM hitl_requests WHERE id=?').get('request') as Record<string, unknown>;
  return { client, db, auth, browser, service, body, row, readCurrent, requirement, disclosure, payload, continuation, definitions,
    expire: () => { now += 3_600_000; } };
}

describe('GoalLaunchDecisionService (real SQLite, real browser auth, real waiting verifier)', () => {
  it('approves exact waiting source and writes server origin once, not launch/execution', async () => {
    const f = fixture(); const before = f.row();
    expect(await f.service.decide({ ...f.body, message: '' }, f.browser)).toEqual({ requestId: 'request', sessionId: 'session', disclosureId: f.body.disclosureId, status: 'approved', revision: 4 });
    const after = f.row(); const cursor = JSON.parse(after.continuation as string);
    expect(cursor).toEqual({ ...f.continuation, approvalOrigin: { schemaVersion: 1, kind: 'decision_browser_goal_launch', authorityMode: 'browser_cookie',
      requestId: 'request', sessionId: 'session', toolCallId: 'call', disclosureId: f.body.disclosureId, approvedFromRevision: 3 } });
    expect(after.payload).toBe(before.payload); expect(JSON.parse(after.outcome as string)).toEqual({ message: '' });
    expect(f.client.prepare('SELECT revision,status,phase FROM chat_runs').get()).toEqual({ revision: 7, status: 'waiting_for_human', phase: 'tool_pending' });
    await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(ConflictException);
    expect(f.row()).toEqual(after);
  });
  it('reject permits future disclosure and corrupt preparing private binding without snapshots/source reads', async () => {
    const f = fixture();
    f.client.prepare('UPDATE hitl_requests SET payload=?,continuation=?').run(JSON.stringify({ ...f.payload,
      goalLaunchDisclosure: { schemaVersion: 99, disclosureId: f.body.disclosureId, unsupported: true } }),
    JSON.stringify({ ...f.continuation, hostConfirmationRequirement: { kind: 'human_only', toolName: 'run_sub_agentflow', callId: 'call', goalLaunch: 'corrupt' } }));
    f.client.exec('DROP TABLE messages; DROP TABLE chat_runs;');
    expect(await f.service.decide({ ...f.body, decision: 'reject', message: ' \n' }, f.browser)).toMatchObject({ status: 'denied', revision: 4 });
    expect(f.readCurrent).not.toHaveBeenCalled(); expect(JSON.parse(f.row().continuation as string)).not.toHaveProperty('approvalOrigin');
    expect(JSON.parse(f.row().outcome as string)).toEqual({ message: ' \n' });
  });
  it.each(['approve', 'reject'] as const)('pending existing approval origin conflicts for %s', async decision => {
    const f = fixture(); f.client.prepare('UPDATE hitl_requests SET continuation=?').run(JSON.stringify({ ...f.continuation, approvalOrigin: null }));
    const before = f.row(); await expect(f.service.decide({ ...f.body, decision }, f.browser)).rejects.toBeInstanceOf(ConflictException);
    expect(f.row()).toEqual(before); expect(f.readCurrent).not.toHaveBeenCalled();
  });
  it.each(['approve', 'reject'] as const)('pending own hostExecutionCommit conflicts before snapshots or writes for %s', async decision => {
    for (const hostExecutionCommit of [null, { requestId: 'request', claimedRevision: 2, committedRevision: 3,
      status: 'approved', executionState: 'tool_result_committed', resultStatus: 'success' }]) {
      const f = fixture(); f.client.prepare('UPDATE hitl_requests SET continuation=?').run(JSON.stringify({ ...f.continuation, hostExecutionCommit }));
      const before = f.row();
      await expect(f.service.decide({ ...f.body, decision }, f.browser)).rejects.toBeInstanceOf(ConflictException);
      expect(f.row()).toEqual(before); expect(f.readCurrent).not.toHaveBeenCalled();
    }
  });
  it.each(['sessionId', 'requestId', 'disclosureId'] as const)('rejects wrong selector %s', async field => {
    const f = fixture(); const before = f.row();
    await expect(f.service.decide({ ...f.body, [field]: field === 'disclosureId' ? 'v'.repeat(21) : 'foreign' }, f.browser)).rejects.toBeInstanceOf(ConflictException);
    expect(f.row()).toEqual(before);
  });
  it('fails auth before snapshot/DB and rejects valid env bearer with cookie', async () => {
    const f = fixture(); f.browser.headers.authorization = `Bearer ${'a'.repeat(64)}`; const before = f.row();
    await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f.row()).toEqual(before); expect(f.readCurrent).not.toHaveBeenCalled();
  });
  it('rechecks cookie expiry after async snapshot', async () => {
    const f = fixture(); const snapshot = f.readCurrent.getMockImplementation()!; const before = f.row();
    f.readCurrent.mockImplementation(async (...args) => { const current = await snapshot(...args); f.expire(); return current; });
    await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(UnauthorizedException); expect(f.row()).toEqual(before);
  });
  it('snapshot port cannot mutate the captured requirement used for source/commit', async () => {
    const f = fixture(); const snapshot = f.readCurrent.getMockImplementation()!;
    f.readCurrent.mockImplementation(async (requirement, signal) => {
      requirement.goalLaunch.parentRunId = 'forged'; requirement.goalLaunch.disclosureSha256 = 'f'.repeat(64);
      return snapshot(requirement, signal);
    });
    expect(await f.service.decide(f.body, f.browser)).toMatchObject({ status: 'approved' });
    expect(JSON.parse(f.row().continuation as string).hostConfirmationRequirement).toEqual(f.requirement);
  });
  it.each(['payload', 'continuation'] as const)('rejects raw %s byte changes across await despite semantic equality', async column => {
    const f = fixture(); const snapshot = f.readCurrent.getMockImplementation()!;
    f.readCurrent.mockImplementation(async (...args) => {
      f.client.prepare(`UPDATE hitl_requests SET ${column}=?`).run(` ${f.row()[column] as string}`); return snapshot(...args);
    });
    await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(ConflictException); expect(f.row().revision).toBe(3);
  });
  it.each(['flowDefinitionId', 'schemaId', 'policyId', 'flowDefinition', 'schemaDefinition', 'policy'] as const)('rejects snapshot identity/hash drift %s', async field => {
    const f = fixture(); const snapshot = f.readCurrent.getMockImplementation()!; const before = f.row();
    f.readCurrent.mockImplementation(async (...args) => ({ ...await snapshot(...args), [field]: 'changed' }));
    await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(ConflictException); expect(f.row()).toEqual(before);
  });
  it('rejects ineligible snapshots and preparing requirement without required waiting revision', async () => {
    const f = fixture(); f.readCurrent.mockResolvedValue({ status: 'ineligible' }); const before = f.row();
    await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(ConflictException); expect(f.row()).toEqual(before);
    const binding: Record<string, unknown> = { ...f.requirement.goalLaunch }; delete binding.parentWaitingRevision;
    f.client.prepare('UPDATE hitl_requests SET continuation=?').run(JSON.stringify({ ...f.continuation, hostConfirmationRequirement: { ...f.requirement, goalLaunch: binding } }));
    f.readCurrent.mockClear(); await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(ConflictException);
    expect(f.readCurrent).not.toHaveBeenCalled();
  });
  it.each(['status', 'phase', 'revision'] as const)('real waiting verifier blocks source journal %s drift', async field => {
    const f = fixture(); f.client.prepare(`UPDATE chat_runs SET ${field}=?`).run(field === 'revision' ? 8 : 'foreign'); const before = f.row();
    await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(ConflictException); expect(f.row()).toEqual(before);
  });
  it('duplicate source call fails real waiting proof', async () => {
    const f = fixture(); f.client.exec("INSERT INTO messages SELECT 'duplicate',session_id,turn_id,prompt_message_id,role,tool_calls FROM messages WHERE id='assistant'");
    const before = f.row(); await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(ConflictException); expect(f.row()).toEqual(before);
  });
  it('forged disclosure with recomputed hash cannot override the persisted call goal', async () => {
    const f = fixture(); const disclosure = { ...f.disclosure, goal: 'forged' };
    const requirement = { ...f.requirement, goalLaunch: { ...f.requirement.goalLaunch, disclosureSha256: hashGoalLaunchJson(disclosure) } };
    f.client.prepare('UPDATE hitl_requests SET payload=?,continuation=?').run(JSON.stringify({ ...f.payload, goalLaunchDisclosure: disclosure }),
      JSON.stringify({ ...f.continuation, hostConfirmationRequirement: requirement }));
    const before = f.row(); await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(ConflictException); expect(f.row()).toEqual(before);
  });
  it.each(['session_id', 'run_id', 'turn_id', 'tool_call_id', 'kind', 'status', 'revision'] as const)('full pending binding %s drift across await conflicts', async field => {
    const f = fixture(); const snapshot = f.readCurrent.getMockImplementation()!;
    f.readCurrent.mockImplementation(async (...args) => {
      f.client.prepare(`UPDATE hitl_requests SET ${field}=?`).run(field === 'revision' ? 4 : 'foreign'); return snapshot(...args);
    });
    await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(ConflictException);
    expect(f.row().outcome).toBeNull();
  });
  it('reject preserves an explicit empty message and creates no origin', async () => {
    const f = fixture(); const before = f.row();
    await f.service.decide({ ...f.body, decision: 'reject', message: '' }, f.browser);
    expect(f.row().continuation).toBe(before.continuation); expect(f.row().payload).toBe(before.payload);
    expect(JSON.parse(f.row().outcome as string)).toEqual({ message: '' }); expect(f.readCurrent).not.toHaveBeenCalled();
  });
  it.each(['kind', 'toolName', 'callId'] as const)('reject requires actual host marker %s', async field => {
    const f = fixture(); f.client.prepare('UPDATE hitl_requests SET continuation=?').run(JSON.stringify({ ...f.continuation,
      hostConfirmationRequirement: { ...f.requirement, [field]: 'foreign' } })); const before = f.row();
    await expect(f.service.decide({ ...f.body, decision: 'reject' }, f.browser)).rejects.toBeInstanceOf(ConflictException);
    expect(f.row()).toEqual(before); expect(f.readCurrent).not.toHaveBeenCalled();
  });
  it('reject requires valid envelope even though it ignores unsupported private source', async () => {
    const f = fixture(); f.client.prepare('UPDATE hitl_requests SET payload=?').run(JSON.stringify({ ...f.payload,
      goalLaunchDisclosure: { schemaVersion: 0, disclosureId: f.body.disclosureId } })); const before = f.row();
    await expect(f.service.decide({ ...f.body, decision: 'reject' }, f.browser)).rejects.toBeInstanceOf(ConflictException);
    expect(f.row()).toEqual(before);
  });
  it('snapshot getters are never invoked and caller supplied hash strings are not trusted', async () => {
    const f = fixture(); const snapshot = f.readCurrent.getMockImplementation()!; const getter = vi.fn(() => { throw new Error('SECRET'); });
    f.readCurrent.mockImplementation(async (...args) => Object.defineProperty(await snapshot(...args), 'policy', { get: getter, enumerable: true }));
    await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(ConflictException); expect(getter).not.toHaveBeenCalled();
    f.readCurrent.mockImplementation(async (...args) => ({ ...await snapshot(...args), policySha256: f.requirement.goalLaunch.policySha256 }));
    await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(ConflictException);
  });
  it('abort during rejected snapshot await is sanitized and does not write', async () => {
    const f = fixture(); const before = f.row(); const controller = new AbortController();
    f.readCurrent.mockImplementation(async () => { controller.abort(new Error('SECRET')); throw new Error('SECRET'); });
    await expect(f.service.decide(f.body, f.browser, controller.signal)).rejects.toThrow('GOAL_LAUNCH_DECISION_ABORTED');
    expect(f.row()).toEqual(before);
  });
  it('reject wins over an approval still awaiting its snapshot; approval cannot add origin afterward', async () => {
    const f = fixture(); let release!: () => void; let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; }); const snapshot = f.readCurrent.getMockImplementation()!;
    f.readCurrent.mockImplementation(async (...args) => { entered(); await new Promise<void>(resolve => { release = resolve; }); return snapshot(...args); });
    const approval = f.service.decide(f.body, f.browser); await waiting;
    await f.service.decide({ ...f.body, decision: 'reject' }, f.browser); release();
    await expect(approval).rejects.toBeInstanceOf(ConflictException);
    expect(f.row().revision).toBe(4); expect(f.row().status).toBe('denied'); expect(JSON.parse(f.row().continuation as string)).not.toHaveProperty('approvalOrigin');
  });
  it('constructor does not accept a missing mandatory snapshot port', () => {
    const f = fixture();
    expect(() => new GoalLaunchDecisionService(f.db, f.auth, undefined as unknown as GoalLaunchSnapshotPort)).toThrow('GOAL_LAUNCH_DECISION_PERSISTENCE_FAILED');
  });
  it('only one concurrent async approval commits', async () => {
    const f = fixture(); const results = await Promise.allSettled([f.service.decide(f.body, f.browser), f.service.decide(f.body, f.browser)]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']); expect(f.row().revision).toBe(4);
  });
  it('final readback corruption rolls back origin, outcome and status', async () => {
    const f = fixture(); const before = f.row();
    f.client.exec("CREATE TRIGGER corrupt_decision AFTER UPDATE OF status ON hitl_requests BEGIN UPDATE hitl_requests SET revision=99 WHERE id=NEW.id; END;");
    await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(ConflictException); expect(f.row()).toEqual(before);
  });
  it('rejects malformed body and abort without leaking content/reason', async () => {
    const f = fixture(); const getter = vi.fn(() => { throw new Error('SECRET'); });
    await expect(f.service.decide(Object.defineProperty({ ...f.body }, 'message', { get: getter, enumerable: true }), f.browser)).rejects.toBeInstanceOf(BadRequestException);
    expect(getter).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort(new Error('SECRET'));
    await expect(f.service.decide(f.body, f.browser, controller.signal)).rejects.toThrow('GOAL_LAUNCH_DECISION_ABORTED');
  });
  it('sanitizes snapshot and DB failures', async () => {
    const f = fixture(); f.readCurrent.mockRejectedValue(new Error('SECRET snapshot'));
    await expect(f.service.decide(f.body, f.browser)).rejects.toBeInstanceOf(ServiceUnavailableException);
    f.client.exec('DROP TABLE hitl_requests');
    await expect(f.service.decide(f.body, f.browser)).rejects.toThrow('GOAL_LAUNCH_DECISION_PERSISTENCE_FAILED');
  });
});
