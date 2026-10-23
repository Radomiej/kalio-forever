import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, expect, it, vi } from 'vitest';
import type { GoalLaunchDisclosureV1, GoalLaunchHostRequirement } from '@kalio/types';
import * as schema from '../database/schema';
import { canonicalGoalLaunchJson, hashGoalLaunchJson } from './goal-launch-canonical';
import { assertGoalLaunchWaitingSource } from './goal-launch-waiting-source';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(client => client.close()));
function fixture() {
  const client = new Database(':memory:'); clients.push(client);
  client.exec(`CREATE TABLE hitl_requests (id TEXT PRIMARY KEY,kind TEXT,status TEXT,session_id TEXT,run_id TEXT,turn_id TEXT,
    tool_call_id TEXT,revision INTEGER,payload TEXT,continuation TEXT,outcome TEXT,resolved_at INTEGER);
    CREATE TABLE chat_runs (id TEXT PRIMARY KEY,session_id TEXT,turn_id TEXT,revision INTEGER,status TEXT,phase TEXT,completed_at INTEGER);
    CREATE TABLE messages (id TEXT PRIMARY KEY,session_id TEXT,turn_id TEXT,prompt_message_id TEXT,role TEXT,tool_calls TEXT);`);
  const disclosure: GoalLaunchDisclosureV1 = { schemaVersion: 1, kind: 'goal_launch', preset: { id: 'flow', name: 'Devin + Jev' },
    goal: ' Build Żółć 😀\n', behavior: 'attempt_goal_continuation_until_review_or_blocked',
    approvalBoundary: 'confirmation_required_actions_remain_independent', disclosureId: 'abcdefghijklmnopqrstu' };
  const args = { flowId: 'flow', goal: disclosure.goal, context: { b: 2, a: 1 } };
  const requirement: GoalLaunchHostRequirement = { kind: 'human_only', toolName: 'run_sub_agentflow', callId: 'call', goalLaunch: {
    schemaVersion: 1, parentWaitingRevision: 7, disclosureSha256: hashGoalLaunchJson(disclosure), argsSha256: hashGoalLaunchJson(args),
    parentRunId: 'run', parentSessionId: 'session', parentTurnId: 'turn', promptMessageId: 'prompt', assistantMessageId: 'assistant',
    flowDefinitionId: 'flow', schemaId: 'schema', policyId: 'policy', flowDefinitionSha256: 'a'.repeat(64),
    schemaDefinitionSha256: 'b'.repeat(64), policySha256: 'c'.repeat(64) } };
  const payload = { toolName: 'run_sub_agentflow', args, goalLaunchDisclosure: disclosure };
  const continuation = { version: 1, kind: 'approved_tool_then_resume_turn', phase: 'tool_pending', executionState: 'pending',
    runId: 'run', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt', messageId: 'assistant', hostConfirmationRequirement: requirement };
  client.prepare('INSERT INTO hitl_requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('request', 'tool_confirmation', 'pending', 'session', 'run', 'turn', 'call', 3, JSON.stringify(payload), JSON.stringify(continuation), null, null);
  client.exec("INSERT INTO chat_runs VALUES ('run','session','turn',7,'waiting_for_human','tool_pending',NULL); INSERT INTO messages VALUES ('prompt','session','turn',NULL,'user',NULL)");
  client.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?)').run('assistant', 'session', 'turn', 'prompt', 'assistant', JSON.stringify([{ id: 'call', name: 'run_sub_agentflow', args }]));
  const db = drizzle(client, { schema });
  const input = { requestId: 'request', requestRevision: 3, requirement, disclosure };
  return { client, db, input, args, payload, continuation };
}
it('verifies exact pending request and paused persisted source within caller transaction without writes', () => {
  const { db, input, client } = fixture();
  db.transaction(tx => { expect(client.inTransaction).toBe(true); expect(assertGoalLaunchWaitingSource(tx, input)).toBeUndefined(); });
  expect(client.inTransaction).toBe(false);
  expect(client.prepare('SELECT revision,status FROM hitl_requests').get()).toEqual({ revision: 3, status: 'pending' });
});
it.each(['status','kind','session_id','run_id','turn_id','tool_call_id','revision'])('rejects request mismatch %s', column => {
  const { db, input, client } = fixture(); client.prepare(`UPDATE hitl_requests SET ${column}=?`).run(column === 'revision' ? 4 : 'foreign');
  expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
});
it.each(['status','phase','revision','session_id','turn_id','completed_at'])('rejects nonpaused/mismatched journal %s', column => {
  const { db, input, client } = fixture(); client.prepare(`UPDATE chat_runs SET ${column}=?`).run(column === 'revision' ? 8 : column === 'completed_at' ? 123 : column === 'status' ? 'active' : column === 'phase' ? 'tool_running' : 'foreign');
  expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
});
it.each(['prompt','assistant'])('rejects missing %s message', id => {
  const { db, input, client } = fixture(); client.prepare('DELETE FROM messages WHERE id=?').run(id);
  expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
});
it.each(['session_id','turn_id','prompt_message_id','role'])('rejects assistant link %s', column => {
  const { db, input, client } = fixture(); client.exec(`UPDATE messages SET ${column}='foreign' WHERE id='assistant'`);
  expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
});
it.each(['session_id','turn_id','role'])('rejects source user link %s', column => {
  const { db, input, client } = fixture(); client.exec(`UPDATE messages SET ${column}='foreign' WHERE id='prompt'`);
  expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
});
it('rejects duplicate call even on a different prompt in the same turn', () => {
  const { db, input, client } = fixture();
  client.exec("INSERT INTO messages SELECT 'duplicate',session_id,turn_id,'another-prompt',role,tool_calls FROM messages WHERE id='assistant'");
  expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
});
it('rejects two pending HITL requests for the same exact source call, regardless of ID or time', () => {
  const { db, input, client } = fixture();
  client.exec("INSERT INTO hitl_requests SELECT 'duplicate',kind,status,session_id,run_id,turn_id,tool_call_id,revision,payload,continuation,outcome,resolved_at FROM hitl_requests WHERE id='request'");
  for (const requestId of ['request', 'duplicate']) {
    expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, { ...input, requestId }))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
  }
});
it.each(['approvalOrigin', 'hostExecutionCommit'])('rejects own preapproval continuation key %s even when null', field => {
  for (const value of [null, {}]) {
    const { db, input, client, continuation } = fixture();
    client.prepare('UPDATE hitl_requests SET continuation=?').run(JSON.stringify({ ...continuation, [field]: value }));
    expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
  }
});
it('ignores foreign pending request scope, never choosing a newest matching request', () => {
  const { db, input, client } = fixture();
  client.exec("INSERT INTO hitl_requests SELECT 'foreign',kind,status,session_id,run_id,'other-turn',tool_call_id,revision,payload,continuation,outcome,resolved_at FROM hitl_requests");
  db.transaction(tx => assertGoalLaunchWaitingSource(tx, input));
});
it('rejects duplicate call in a single row, but ignores another session/turn', () => {
  const { db, input, client, args } = fixture();
  client.exec("INSERT INTO messages SELECT 'foreign',session_id,'other-turn',prompt_message_id,role,tool_calls FROM messages WHERE id='assistant'");
  db.transaction(tx => assertGoalLaunchWaitingSource(tx, input));
  const call = { id: 'call', name: 'run_sub_agentflow', args };
  client.prepare("UPDATE messages SET tool_calls=? WHERE id='assistant'").run(JSON.stringify([call, call]));
  expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
});
it.each(['runId','sessionId','turnId','promptMessageId','messageId','executionState','kind','phase','version'])('rejects continuation %s drift', field => {
  const { db, input, client, continuation } = fixture();
  client.prepare('UPDATE hitl_requests SET continuation=?').run(JSON.stringify({ ...continuation, [field]: field === 'version' ? 2 : 'foreign' }));
  expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
});
it('rejects preparing requirement, missing disclosure and requirement/hash drift', () => {
  for (const variant of ['preparing','missing','hash','goal','args','name']) {
    const { db, input, client, payload, continuation } = fixture();
    if (variant === 'preparing') {
      const goalLaunch: Record<string, unknown> = { ...input.requirement.goalLaunch }; delete goalLaunch.parentWaitingRevision;
      client.prepare('UPDATE hitl_requests SET continuation=?').run(JSON.stringify({ ...continuation, hostConfirmationRequirement: { ...input.requirement, goalLaunch } }));
    } else if (variant === 'hash') {
      input.requirement.goalLaunch.argsSha256 = 'f'.repeat(64);
    } else {
      const changed: Record<string, unknown> = { ...payload };
      if (variant === 'missing') delete changed.goalLaunchDisclosure;
      if (variant === 'goal') changed.goalLaunchDisclosure = { ...input.disclosure, goal: 'other' };
      if (variant === 'args') changed.args = { ...payload.args, goal: 'other' };
      if (variant === 'name') changed.toolName = 'terminal_spawn';
      client.prepare('UPDATE hitl_requests SET payload=?').run(JSON.stringify(changed));
    }
    expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
  }
});
it('rejects a consistent forged disclosure goal when persisted call goal differs', () => {
  const { db, input, client, payload, continuation } = fixture(); input.disclosure.goal = 'forged';
  input.requirement.goalLaunch.disclosureSha256 = hashGoalLaunchJson(input.disclosure);
  client.prepare('UPDATE hitl_requests SET payload=?,continuation=?').run(JSON.stringify({ ...payload, goalLaunchDisclosure: input.disclosure }), JSON.stringify(continuation));
  expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
});
it('accepts canonical equality without object insertion-order dependence', () => {
  const { db, input, client, payload } = fixture();
  client.prepare('UPDATE hitl_requests SET payload=?').run(canonicalGoalLaunchJson(payload));
  db.transaction(tx => assertGoalLaunchWaitingSource(tx, input));
});
it.each(['payload','continuation'])('rejects corrupt stored %s JSON', column => {
  const { db, input, client } = fixture(); client.exec(`UPDATE hitl_requests SET ${column}='{'`);
  expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
});
it('rejects corrupt persisted calls and wrong call name', () => {
  for (const raw of ['{', '[null]', JSON.stringify([{ id: 'call', name: 'terminal_spawn', args: {} }])]) {
    const { db, input, client } = fixture(); client.prepare("UPDATE messages SET tool_calls=? WHERE id='assistant'").run(raw);
    expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
  }
});
it('rejects getters/proxies before reading inputs', () => {
  const { db, input } = fixture(); const getter = vi.fn(() => { throw new Error('SECRET'); });
  const hostile = Object.defineProperty({ ...input }, 'requirement', { get: getter, enumerable: true });
  expect(() => assertGoalLaunchWaitingSource(db, hostile)).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
  expect(getter).not.toHaveBeenCalled();
  expect(() => assertGoalLaunchWaitingSource(db, new Proxy(input, { get: getter }))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
  expect(getter).not.toHaveBeenCalled();
});
it('sanitizes aborted signal and driver errors and lets caller roll back its writes', () => {
  const { db, input, client } = fixture(); const controller = new AbortController(); controller.abort(new Error('SECRET'));
  expect(() => assertGoalLaunchWaitingSource(db, input, controller.signal)).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_ABORTED$/);
  expect(() => db.transaction(tx => { tx.run('UPDATE hitl_requests SET revision=4'); assertGoalLaunchWaitingSource(tx, input); })).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
  expect(client.prepare('SELECT revision FROM hitl_requests').get()).toEqual({ revision: 3 });
  client.exec('DROP TABLE messages');
  expect(() => assertGoalLaunchWaitingSource(db, input)).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER+1])('rejects invalid request revision %s', requestRevision => {
  const { db, input } = fixture();
  expect(() => assertGoalLaunchWaitingSource(db, { ...input, requestRevision })).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
});
it.each(['outcome','resolved_at'])('rejects pending request with contradictory resolved field %s', column => {
  const { db, input, client } = fixture(); client.prepare(`UPDATE hitl_requests SET ${column}=?`).run(column === 'outcome' ? '{}' : 1);
  expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
});
it('rejects absent requests/journals and invalid stored UTF8 without fallback', () => {
  for (const mutation of ["DELETE FROM hitl_requests", "DELETE FROM chat_runs", "UPDATE hitl_requests SET payload=CAST(X'FF' AS TEXT)", "UPDATE messages SET tool_calls=CAST(X'FF' AS TEXT) WHERE id='assistant'"]) {
    const { db, input, client } = fixture(); client.exec(mutation);
    expect(() => assertGoalLaunchWaitingSource(db, input)).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
  }
});
it('checks abort after SQLite read and leaves rollback to the caller', () => {
  const { db, input, client } = fixture(); const controller = new AbortController();
  client.function('stop_read', () => { controller.abort('PRIVATE'); return 'tool_confirmation'; });
  client.exec('ALTER TABLE hitl_requests RENAME TO stored_requests; CREATE VIEW hitl_requests AS SELECT id,stop_read() AS kind,status,session_id,run_id,turn_id,tool_call_id,revision,payload,continuation,outcome,resolved_at FROM stored_requests');
  expect(() => db.transaction(tx => assertGoalLaunchWaitingSource(tx, input, controller.signal))).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_ABORTED$/);
  expect(client.inTransaction).toBe(false);
});
it('rejects nested input accessors and preparing input itself without reading getters', () => {
  const { db, input } = fixture(); const getter = vi.fn(() => { throw new Error('PRIVATE'); });
  const binding = Object.defineProperty({ ...input.requirement.goalLaunch }, 'parentWaitingRevision', { enumerable: true, get: getter });
  expect(() => assertGoalLaunchWaitingSource(db, { ...input, requirement: { ...input.requirement, goalLaunch: binding } })).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
  expect(getter).not.toHaveBeenCalled();
  const preparing: Record<string, unknown> = { ...input.requirement.goalLaunch }; delete preparing.parentWaitingRevision;
  expect(() => assertGoalLaunchWaitingSource(db, { ...input, requirement: { ...input.requirement, goalLaunch: preparing } } as typeof input)).toThrow(/^GOAL_LAUNCH_WAITING_SOURCE_INVALID$/);
});
