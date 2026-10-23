import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { HostRuntimeReceiptIdentity, HostRuntimeToolAdmission, HostResolvedToolDispatch, HostRuntimeToolCommit, HostRuntimeReceiptObserver } from '@kalio/types';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { AuditService } from '../chat/audit.service';
import { PersistedRuntimeEvidenceReader } from '../chat/persisted-runtime-evidence-reader';
import { PersistedGoalSourceReader } from '../chat/persisted-goal-source-reader';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { ToolConfirmationService } from '../chat/tool-confirmation.service';
import { ToolDispatchService } from '../chat/tool-dispatch.service';
import { HostDispatchReceiptService } from '../chat/host-dispatch-receipt.service';
import { createHostDispatchPersistenceAuthority } from '../chat/host-dispatch-persistence-authority';
import { dispatchRuntimeTool, TurnExecutionLane } from '../chat/llm-turn-tool-execution';
import { TurnState } from '../chat/turn-state';
import type { StreamContext } from '../chat/interfaces/stream-context.interface';
import type { LLMAgentLoopRequest } from '../chat/llm-turn-runtime.types';
import type { SessionManagerService } from '../chat/session-manager.service';
import { ArchitectureGoalRepository } from './architecture-goal.repository';
import { createGoalPacket } from './architecture-goal-source';
import { acceptGoalProjection, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';
import { ArchitectureGoalReceiptProducer, type GoalReceiptProducerPorts, type GoalReceiptPersistedScope, type GoalReceiptApprovedScope } from './architecture-goal-receipt-producer';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(client => client.close()));
const identity: HostRuntimeReceiptIdentity = { runId: 'journal', sessionId: 'branch', turnId: 'turn', promptMessageId: 'prompt' };
const run = { id: 'architecture', rootSessionId: 'root', schemaId: 'devin-jev' };
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const approved: GoalReceiptApprovedScope = { branchSessionId: 'branch', projectId: 'project', executionProfileId: 'profile', allowedToolNames: ['read'], buildExpectation: null };
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const admission = (callId = 'call'): HostRuntimeToolAdmission => ({ identity, callId, toolName: 'read', args: { token: 'SECRET-ARG', path: 'src' } });
const completed = () => ({ id: 'journal', sessionId: 'branch', turnId: 'turn', phase: 'completed' as const, status: 'completed' as const,
  revision: 7, retryCount: 0, safeResume: false, startedAt: 1, updatedAt: 3000, lastHeartbeatAt: 3000, completedAt: 3000,
  outcome: { messageId: 'terminal', finalText: 'SECRET-PROMPT' } });

function fixture(build = false) {
  const client = new Database(':memory:'); clients.push(client);
  client.exec(`CREATE TABLE architecture_goal_states (run_id TEXT PRIMARY KEY, root_session_id TEXT, state_revision INTEGER,
    source_version INTEGER, projection_status TEXT, source_fingerprint TEXT, goal_fingerprint TEXT, packet_json TEXT,
    created_at INTEGER, updated_at INTEGER, evidence_inventory_json TEXT, completion_authorization_json TEXT);
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, label TEXT, data TEXT, duration_ms INTEGER, chunk_count INTEGER, created_at INTEGER);
    CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, turn_id TEXT, prompt_message_id TEXT, tool_call_id TEXT, created_at INTEGER);
    CREATE TABLE chat_runs (id TEXT PRIMARY KEY, session_id TEXT, turn_id TEXT, phase TEXT, status TEXT, revision INTEGER, outcome TEXT, completed_at INTEGER, updated_at INTEGER);
    CREATE TABLE hitl_requests (id TEXT PRIMARY KEY, kind TEXT, status TEXT, session_id TEXT, turn_id TEXT, run_id TEXT, tool_call_id TEXT,
      payload TEXT, continuation TEXT, outcome TEXT, revision INTEGER, created_at INTEGER, updated_at INTEGER, resolved_at INTEGER);
    CREATE TABLE fixture_registered_scope (snapshot TEXT NOT NULL);`);
  const dependency = { db: drizzle(client, { schema }) } as unknown as DrizzleService;
  const repository = new ArchitectureGoalRepository(dependency);
  const audit = new AuditService(dependency);
  const reader = new PersistedRuntimeEvidenceReader(dependency);
  const sources = new PersistedGoalSourceReader(dependency);
  const hitl = new HitlRequestService(dependency);
  const pending = createGoalPacket({ messageId: 'source', sessionId: 'root', turnId: 'source-turn', content: 'SECRET-PROMPT goal', createdAt: 1000 });
  const proposal = prepareGoalProjection(pending, { sourceVersion: 1, criteria: [
    { text: 'goal', sourceQuotes: [{ messageId: 'source', quote: 'goal' }], supersedes: [] },
  ] });
  pending.projection = { status: 'pending', base: null, proposal };
  const packet = acceptGoalProjection(pending, proposal, { requiredEvidenceKindsByCriterion: Object.fromEntries(
    goalProjectionPolicyTargets(pending, proposal).map(row => [row.id, [build ? 'BUILD_RESULT' : 'TOOL_RESULT']]),
  ) }, { sourceVersion: 1, sourceFingerprint: pending.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
  repository.create({ runId: run.id, rootSessionId: run.rootSessionId, packet, createdAt: 1, updatedAt: 1 });
  client.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('source', 'root', 'user', pending.original.content, 'source-turn', null, null, 1000);
  const scope: GoalReceiptPersistedScope = { rootSessionId: 'root', parentSessionId: 'root', branchSessionId: 'branch', projectId: 'project',
    executionProfileId: 'profile', canonicalProjectRoot: 'E:\\project', canonicalCwd: 'E:\\project\\src' };
  client.prepare('INSERT INTO fixture_registered_scope VALUES (?)').run(JSON.stringify(scope));
  const entry = { execute: async () => 'result' };
  const target = { kind: 'kalio_registry' as const, entryIdentity: entry, executorIdentity: entry.execute, requiresConfirmation: false };
  // Explicit fixture-only host adapters. Production has no default/boolean verifier.
  const ports: Mutable<GoalReceiptProducerPorts> = { repository, audit, durableReader: reader, sourceReader: sources,
    registry: { snapshot: () => [{ canonicalName: 'read', target }] },
    persistedScope: { readRegisteredScope: async () => {
      const row = client.prepare('SELECT snapshot FROM fixture_registered_scope').get() as { snapshot: string } | undefined;
      if (!row) throw new Error('missing registered scope');
      return JSON.parse(row.snapshot) as GoalReceiptPersistedScope;
    } } };
  const controller = new AbortController();
  const open = (revision = 1, policy = approved) => new ArchitectureGoalReceiptProducer(ports).create(run, revision, policy, controller.signal);
  const resolved = (callId = 'call'): Mutable<HostResolvedToolDispatch> => ({ identity, callId, requestedName: 'read', canonicalName: 'read',
    args: admission(callId).args, target, approval: { kind: 'non_durable', reason: 'not_required' } });
  const saveResult = (callId = 'call', content = '  Żółć\r\n😀  ', status: HostRuntimeToolCommit['status'] = 'success', dispatch: HostResolvedToolDispatch | null = resolved(callId)): Mutable<HostRuntimeToolCommit> => {
    client.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(`result-${callId}`, 'branch', 'tool_result', content, 'turn', 'prompt', callId, 2000);
    return { identity, callId, toolName: 'read', persistedMessageId: `result-${callId}`, contentSha256: hash(content), status,
      registeredCommitAck: 'not_registered', resolvedDispatch: dispatch, hitlCommit: null };
  };
  const saveJournal = () => {
    client.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('terminal', 'branch', 'assistant', 'SECRET-PROMPT', 'turn', 'prompt', null, 2500);
    client.prepare('INSERT INTO chat_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('journal', 'branch', 'turn', 'completed', 'completed', 7, JSON.stringify(completed().outcome), 3000, 3000);
  };
  const events = () => client.prepare('SELECT id, data FROM audit_log ORDER BY rowid').all().map(row => {
    const record = row as { id: string; data: string }; return { id: record.id, data: JSON.parse(record.data) as Record<string, unknown> };
  });
  const state = () => repository.load(run.id, run.rootSessionId)!;
  return { client, dependency, repository, audit, reader, hitl, ports, controller, open, resolved, saveResult, saveJournal, events, state, scope, target };
}

async function executed(f: ReturnType<typeof fixture>, observer: HostRuntimeReceiptObserver) {
  await observer.admit(admission());
  await observer.resolvedDispatch!(f.resolved());
  await observer.commit(f.saveResult());
}

describe('goal receipt producer real SQLite persistence', () => {
  it.each([{ manual: false, recorded: false }, { manual: true, recorded: false }, { manual: false, recorded: true }, { manual: true, recorded: true }])(
    'actual resolution -> Stop -> no-entry (confirmation=$manual, execution-signal recorder=$recorded)', async ({ manual, recorded }) => {
    const f = fixture(); let executions = 0;
    const entry = { meta: { name: 'read', description: '', parameters: {}, requiresConfirmation: manual },
      catalogEntryId: 'fixture.read', executorImplementationId: 'fixture.read.execute', executorImplementationVersion: 1,
      execute: async () => { executions++; return 'must not execute'; } };
    f.target.entryIdentity = entry; f.target.executorIdentity = entry.execute; f.target.requiresConfirmation = manual;
    const producer = await f.open();
    // Stop the actual tool turn, not the producer's independent durable-write lane.
    const turnStop = new AbortController(); const commits: HostRuntimeToolCommit[] = [];
    const observer: HostRuntimeReceiptObserver = { ...producer,
      resolvedDispatch: async receipt => { await producer.resolvedDispatch!(receipt); if (!recorded) turnStop.abort('Stop'); },
      commit: async receipt => { await producer.commit(receipt); commits.push(receipt); } };
    const confirmations = new ToolConfirmationService(null, null, null, f.hitl);
    const dispatch = new ToolDispatchService([entry], null, null, null, null, confirmations);
    const context: StreamContext = { sessionId: 'branch', runId: 'journal', turnId: 'turn', promptMessageId: 'prompt',
      messageId: 'assistant', state: new TurnState(), emit: () => undefined, abortSignal: turnStop.signal };
    const request: LLMAgentLoopRequest = { ...identity, emit: context.emit, abortSignal: turnStop.signal, runtimeKind: 'chat',
      personaId: 'persona', effectiveSystemPrompt: '', maxIterations: 1, toolMetas: dispatch.getToolMetas(), hostRuntimeReceiptObserver: observer };
    if (recorded) {
      f.client.exec(`CREATE TABLE host_dispatch_receipts(run_id TEXT NOT NULL,session_id TEXT NOT NULL,turn_id TEXT NOT NULL,
        prompt_message_id TEXT NOT NULL,call_id TEXT NOT NULL,record_json TEXT NOT NULL,record_sha256 TEXT NOT NULL,created_at INTEGER NOT NULL,
        PRIMARY KEY(run_id,session_id,turn_id,prompt_message_id,call_id));`);
      f.client.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('prompt', 'branch', 'user', 'Read', 'turn', 'prompt', null, 1000);
      f.client.prepare('INSERT INTO chat_runs VALUES (?,?,?,?,?,?,?,?,?)').run('journal', 'branch', 'turn', 'tool_pending', 'active', 1, null, null, 1000);
      expect(await createHostDispatchPersistenceAuthority(f.dependency.db).readJournalScopeExact(identity)).toEqual({ ...identity, revision: 1 });
      const concrete = new HostDispatchReceiptService(f.dependency, [entry], f.reader, null as never);
      request.hostDispatchReceiptRecorder = { createCallRecorder: (call, signal) => {
        expect(signal).toBe(turnStop.signal);
        const actual = concrete.recorder.createCallRecorder(call, signal);
        // Observe Stop AFTER both real pre-entry resolution callbacks acknowledge.
        // Preserve the exact runtime execution signal; no null-signal drain shortcut.
        return { ...actual, resolved: async receipt => { await actual.resolved(receipt); turnStop.abort('Stop'); } };
      } };
    }
    const sessions = { saveToolResult: async (sessionId: string, callId: string, content: string) => {
      f.client.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run(`result-${callId}`, sessionId, 'tool_result', content, 'turn', 'prompt', callId, 2000);
      return `result-${callId}`;
    } } as unknown as SessionManagerService;
    const pending = dispatchRuntimeTool({ request, call: { id: 'call', name: 'read', args: admission().args }, context,
      lane: new TurnExecutionLane(), sessionManager: sessions, toolDispatch: dispatch });
    const outcome = recorded ? expect(pending).rejects.toThrow(/^HOST_DISPATCH_RECEIPT_ABORTED$/)
      : expect(pending).resolves.toMatchObject({ status: 'cancelled' });
    if (manual) {
      let requestId = '';
      await vi.waitFor(() => { const waiting = confirmations.getPendingConfirmations('branch'); expect(waiting).toHaveLength(1); requestId = waiting[0]!.requestId; });
      expect(await confirmations.resolveConfirmation(requestId, 'branch')).toBe('resolved');
    }
    await outcome;
    if (recorded) {
      expect(executions).toBe(0); expect(commits).toEqual([]);
      expect(f.client.prepare('SELECT COUNT(*) AS count FROM host_dispatch_receipts').get()).toEqual({ count: 0 });
      const result = await f.reader.readToolResultExact({ messageId: 'result-call', sessionId: 'branch', turnId: 'turn', promptMessageId: 'prompt', toolCallId: 'call', role: 'tool_result' });
      expect(JSON.parse(result!.content)).toMatchObject({ status: 'cancelled' });
      expect(f.events().filter(row => row.data.recordType === 'phase').map(row => row.data.phase)).toEqual(['opened', 'admitted', 'resolved']);
      if (manual) {
        const row = f.client.prepare('SELECT continuation,outcome FROM hitl_requests').get() as { continuation: string; outcome: string };
        expect(JSON.parse(row.continuation)).toMatchObject({ executionState: 'tool_result_committed', hostExecutionCommit: { resultStatus: 'cancelled' } });
        expect(JSON.parse(row.outcome)).toMatchObject({ status: 'cancelled' });
      }
      await expect(producer.drain(identity)).rejects.toThrow('GOAL_RECEIPT_FAILED');
      expect(f.state().evidenceInventory?.host).toEqual({ evidenceById: {}, cliChildrenById: {} });
      expect(f.state().completionAuthorization).toBeNull();
      return;
    }
    await producer.drain(identity);
    expect(executions).toBe(0);
    expect(commits[0]).toMatchObject({ status: 'cancelled', resolvedDispatch: null, registeredCommitAck: manual ? 'acknowledged' : 'not_registered' });
    const phases = f.events().filter(row => row.data.recordType === 'phase');
    expect(phases.map(row => row.data.phase)).toEqual(['opened', 'admitted', 'resolved', 'committed', 'drained']);
    expect(phases.find(row => row.data.phase === 'resolved')?.data.resolved).toMatchObject({ canonicalName: 'read' });
    expect(phases.find(row => row.data.phase === 'committed')?.data).toMatchObject({ resolved: null, status: 'cancelled' });
    if (manual) {
      expect(commits[0]!.hitlCommit).toMatchObject({ status: 'approved', executionState: 'tool_result_committed', resultStatus: 'cancelled' });
      const row = await f.hitl.getById(commits[0]!.hitlCommit!.requestId);
      expect(row?.revision).toBe(commits[0]!.hitlCommit!.committedRevision);
    } else expect(commits[0]!.hitlCommit).toBeNull();
    expect(f.state().evidenceInventory?.host).toEqual({ evidenceById: {}, cliChildrenById: {} });
    expect(f.state().completionAuthorization).toBeNull();
  });
  it.each(['success', 'error'] as const)('rejects null-entry %s with or without prior resolution', async status => {
    for (const diagnostic of [false, true]) {
      const f = fixture(); const observer = await f.open(); await observer.admit(admission());
      if (diagnostic) await observer.resolvedDispatch!(f.resolved());
      await expect(observer.commit(f.saveResult('call', 'not entered', status, null))).rejects.toThrow('GOAL_RECEIPT_FAILED');
      expect(f.events().some(row => row.data.phase === 'committed')).toBe(false);
    }
  });
  it.each(['missing', 'foreign', 'revision'])('rejects %s claimed HITL cancellation receipt after pre-entry resolution', async mode => {
    const f = fixture(); f.target.requiresConfirmation = true; const observer = await f.open(); await observer.admit(admission());
    for (const id of ['approved', 'foreign']) {
      await f.hitl.create({ id, kind: 'tool_confirmation', sessionId: 'branch', payload: {}, continuation: { executionState: 'pending' } });
      await f.hitl.resolve(id, 1, 'approved'); await f.hitl.claimApprovedContinuation(id, 2);
    }
    await observer.resolvedDispatch!({ ...f.resolved(), approval: { kind: 'durable_confirmation', requestId: 'approved', claimedRevision: 3 } });
    const commit = f.saveResult('call', 'cancelled', 'cancelled', null); commit.registeredCommitAck = 'acknowledged';
    if (mode !== 'missing') commit.hitlCommit = await f.hitl.markContinuationToolResultRequired(mode === 'foreign' ? 'foreign' : 'approved', 3, { status: 'cancelled' });
    if (mode === 'revision') commit.hitlCommit = { ...commit.hitlCommit!, claimedRevision: 2 };
    await expect(observer.commit(commit)).rejects.toThrow('GOAL_RECEIPT_FAILED');
    expect(f.events().some(row => row.data.phase === 'committed')).toBe(false);
  });
  it('opens before work, persists exact metadata, closes and verifies journal without sealing or attaching evidence', async () => {
    const f = fixture(); const observer = await f.open();
    expect(f.state()).toMatchObject({ stateRevision: 2, completionAuthorization: null, evidenceInventory: { schemaVersion: 2, inventoryStateRevision: 2 } });
    await executed(f, observer); await observer.drain(identity); f.saveJournal(); await observer.journalComplete(identity, completed());
    const state = f.state();
    expect(state.evidenceInventory).toMatchObject({ host: { evidenceById: {}, cliChildrenById: {} }, provenance: {
      checkpoint: { status: 'open', completedRunJournalRef: null, admissions: [{ callId: 'call', sequence: 1 }],
        commits: [{ callId: 'call', sequence: 1, resultMessageId: 'result-call', status: 'success' }] },
      evidenceRefsById: {}, childRefsById: {}, supersededEvidenceIds: {}, buildExpectation: null,
    } });
    const phases = f.events().filter(event => event.data.recordType === 'phase');
    expect(phases.map(event => event.data.phase)).toEqual(['opened', 'admitted', 'resolved', 'committed', 'drained', 'journal_verified']);
    expect(phases[3].data).toMatchObject({ result: { messageId: 'result-call', contentUtf8Bytes: 18, contentSha256: hash('  Żółć\r\n😀  ') },
      registeredCommitAck: 'not_registered', resolved: { canonicalName: 'read', target: { kind: 'kalio_registry', requiresConfirmation: false },
        approval: { kind: 'non_durable', reason: 'not_required' } }, hitlCommit: null });
    expect(phases[5].data).toMatchObject({ journal: { chatRunId: 'journal', sessionId: 'branch', turnId: 'turn', revision: 7,
      promptMessageId: 'prompt', terminalMessageId: 'terminal', status: 'completed', phase: 'completed', completedAt: 3000, updatedAt: 3000 } });
    const anchor = f.events().find(event => event.data.phase === 'inventory_anchor' && event.data.phaseEventId === phases[5].id);
    expect(state.evidenceInventory?.schemaVersion === 2 && state.evidenceInventory.provenance.checkpoint.checkpointId).toBe(anchor?.id);
    const anchors = f.events().filter(event => event.data.recordType === 'inventory_anchor');
    const acknowledgements = f.events().filter(event => event.data.recordType === 'cas_ack');
    expect(anchors).toHaveLength(6); expect(acknowledgements).toHaveLength(6); expect(f.events()).toHaveLength(18);
    expect(new Set(f.events().map(event => event.id)).size).toBe(18);
    for (let index = 0; index < phases.length; index++) {
      expect(anchors[index].data).toMatchObject({ phaseEventId: phases[index].id,
        previousCheckpointId: index === 0 ? null : anchors[index - 1].id, expectedStateRevision: index + 1 });
      expect(phases[index].data).toMatchObject({ phaseSequence: index + 1,
        previousCheckpointId: index === 0 ? null : anchors[index - 1].id, expectedStateRevision: index + 1 });
      expect(acknowledgements[index].data).toMatchObject({ phaseEventId: phases[index].id, forPhase: phases[index].data.phase,
        inventoryCheckpointId: anchors[index].id, stateRevision: index + 2 });
    }
    if (state.evidenceInventory?.schemaVersion !== 2) throw new Error('fixture inventory');
    expect(state.evidenceInventory.provenance.checkpoint.admissions[0].admissionCheckpointId).toBe(phases[1].id);
    expect(state.evidenceInventory.provenance.checkpoint.commits[0].commitCheckpointId).toBe(phases[3].id);
    const serialized = JSON.stringify(f.events());
    expect(serialized).not.toContain('SECRET-ARG'); expect(serialized).not.toContain('SECRET-PROMPT');
    expect(serialized).not.toContain('entryIdentity'); expect(serialized).not.toContain('executorIdentity');
  });

  it('records actual transactional HITL revision without treating confirmation as human/build evidence', async () => {
    const f = fixture(); f.target.requiresConfirmation = true;
    const observer = await f.open(); await observer.admit(admission());
    await f.hitl.create({ id: 'confirmation', kind: 'tool_confirmation', sessionId: 'branch', payload: {}, continuation: { executionState: 'pending' } });
    await f.hitl.resolve('confirmation', 1, 'approved'); await f.hitl.claimApprovedContinuation('confirmation', 2);
    const dispatch = { ...f.resolved(), approval: { kind: 'durable_confirmation' as const, requestId: 'confirmation', claimedRevision: 3 } };
    await observer.resolvedDispatch!(dispatch);
    f.client.exec(`CREATE TRIGGER revision_after_commit AFTER UPDATE OF outcome ON hitl_requests BEGIN UPDATE hitl_requests SET revision = 17 WHERE id = NEW.id; END;`);
    const commit = f.saveResult('call', 'abc', 'success', dispatch);
    commit.registeredCommitAck = 'acknowledged'; commit.hitlCommit = await f.hitl.markContinuationToolResultRequired('confirmation', 3, { status: 'success' });
    await observer.commit(commit);
    expect(f.events().find(event => event.data.phase === 'committed')?.data.hitlCommit).toEqual({ requestId: 'confirmation', claimedRevision: 3,
      committedRevision: 17, status: 'approved', executionState: 'tool_result_committed', resultStatus: 'success' });
    expect(f.state().evidenceInventory?.host.evidenceById).toEqual({});
  });

  it.each(['policy', 'representative', 'subagent_auto', 'explicit_bypass', 'legacy_confirmation'] as const)('preserves non-durable %s classification without HITL fabrication', async reason => {
    const f = fixture(); const observer = await f.open(); await observer.admit(admission());
    const dispatch = { ...f.resolved(), approval: { kind: 'non_durable' as const, reason } };
    await observer.resolvedDispatch!(dispatch); await observer.commit(f.saveResult('call', 'abc', 'success', dispatch));
    expect(f.events().find(event => event.data.phase === 'committed')?.data).toMatchObject({ resolved: { approval: { kind: 'non_durable', reason } }, hitlCommit: null });
  });

  it('allows unknown/cancelled attempts to commit without granting resolved authority', async () => {
    const f = fixture(); const observer = await f.open(); const call = { ...admission(), toolName: 'unknown' };
    await observer.admit(call); const commit = { ...f.saveResult('call', 'cancelled', 'cancelled', null), toolName: 'unknown' };
    await observer.commit(commit); await observer.drain(identity);
    expect(f.events().find(event => event.data.phase === 'committed')?.data.resolved).toBeNull();
  });

  it('rejects existing inventory instead of silently superseding a previous attempt', async () => {
    const f = fixture(); await f.open(); const before = f.state();
    await expect(f.open(before.stateRevision)).rejects.toThrow('GOAL_RECEIPT'); expect(f.state()).toEqual(before);
  });
  it('requires approved build expectation even for an open BUILD policy', async () => {
    const f = fixture(true); await expect(f.open()).rejects.toThrow('GOAL_RECEIPT'); expect(f.state().evidenceInventory).toBeNull();
  });
  it('requires the actual architecture parent rather than any text-valued parent ID', async () => {
    const f = fixture(); f.client.prepare('UPDATE fixture_registered_scope SET snapshot = ?').run(JSON.stringify({ ...f.scope, parentSessionId: 'unrelated-human-session' }));
    await expect(f.open()).rejects.toThrow('GOAL_RECEIPT'); expect(f.state().evidenceInventory).toBeNull();
  });
  it('does not assume the human source session equals the internal architecture root', async () => {
    const f = fixture(); const current = f.state(); const pending = createGoalPacket({ ...current.packet.original, sessionId: 'human-source' });
    const proposal = prepareGoalProjection(pending, { sourceVersion: 1, criteria: [
      { text: 'goal', sourceQuotes: [{ messageId: 'source', quote: 'goal' }], supersedes: [] },
    ] });
    pending.projection = { status: 'pending', base: null, proposal };
    const packet = acceptGoalProjection(pending, proposal, { requiredEvidenceKindsByCriterion: Object.fromEntries(
      goalProjectionPolicyTargets(pending, proposal).map(row => [row.id, ['TOOL_RESULT']]),
    ) }, { sourceVersion: 1, sourceFingerprint: pending.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
    f.repository.compareAndSwap(run.id, 1, { rootSessionId: 'root', packet, updatedAt: 2 });
    f.client.exec("UPDATE messages SET session_id = 'human-source' WHERE id = 'source'");
    await f.open(2); expect(f.state().evidenceInventory?.rootSessionId).toBe('root');
  });
  it('stores externally approved build expectation without executing or qualifying a build', async () => {
    const f = fixture(true); await f.open(1, { ...approved, buildExpectation: {
      approvedSource: { messageId: 'source', sessionId: 'root', turnId: 'source-turn' }, executable: 'pnpm', args: ['build'], canonicalCwd: f.scope.canonicalCwd,
    } });
    expect(f.state().evidenceInventory?.host.evidenceById).toEqual({});
  });

  it.each(['entry', 'executor', 'confirmation', 'name', 'args', 'external', 'native'] as const)('rejects resolved %s mismatch before executor can be entered', async mode => {
    const f = fixture(); const observer = await f.open(); await observer.admit(admission()); const dispatch = f.resolved();
    if (mode === 'entry') dispatch.target = { ...dispatch.target, kind: 'kalio_registry', entryIdentity: {} } as typeof dispatch.target;
    if (mode === 'executor') dispatch.target = { ...dispatch.target, kind: 'kalio_registry', executorIdentity: {} } as typeof dispatch.target;
    if (mode === 'confirmation') dispatch.target = { ...dispatch.target, kind: 'kalio_registry', requiresConfirmation: true } as typeof dispatch.target;
    if (mode === 'name') dispatch.canonicalName = 'write';
    if (mode === 'args') dispatch.args = { path: 'foreign' };
    if (mode === 'external') dispatch.target = { kind: 'external_mcp', serverKey: 'server', originalName: 'read' };
    if (mode === 'native') dispatch.requestedName = 'native_activity';
    await expect(observer.resolvedDispatch!(dispatch)).rejects.toThrow('GOAL_RECEIPT');
    expect(f.events().some(event => event.data.phase === 'resolved')).toBe(false);
    await expect(observer.commit(f.saveResult())).rejects.toThrow('GOAL_RECEIPT');
  });

  it.each(['hash', 'message', 'missing_dispatch', 'hitl', 'identity'] as const)('rejects commit %s mismatch without committing inventory', async mode => {
    const f = fixture(); const observer = await f.open(); await observer.admit(admission()); await observer.resolvedDispatch!(f.resolved());
    const commit = f.saveResult();
    if (mode === 'hash') commit.contentSha256 = hash('foreign');
    if (mode === 'message') commit.persistedMessageId = 'missing';
    if (mode === 'missing_dispatch') commit.resolvedDispatch = null;
    if (mode === 'identity') commit.identity = { ...identity, runId: 'architecture' };
    if (mode === 'hitl') commit.hitlCommit = { requestId: 'forged', claimedRevision: 3, committedRevision: 4, status: 'approved', executionState: 'tool_result_committed', resultStatus: 'success' };
    await expect(observer.commit(commit)).rejects.toThrow('GOAL_RECEIPT');
    expect(f.events().some(event => event.data.phase === 'committed')).toBe(false);
  });

  it('closes admission synchronously before the first drain wait, and rejects repeated drain', async () => {
    const f = fixture(); const observer = await f.open(); await executed(f, observer);
    const draining = observer.drain(identity);
    await expect(observer.admit(admission('late'))).rejects.toThrow('GOAL_RECEIPT');
    await expect(draining).rejects.toThrow('GOAL_RECEIPT');
    await expect(observer.drain(identity)).rejects.toThrow('GOAL_RECEIPT');
  });
  it('fails drain on admitted-but-uncommitted work', async () => {
    const f = fixture(); const observer = await f.open(); await observer.admit(admission());
    await expect(observer.drain(identity)).rejects.toThrow('GOAL_RECEIPT');
  });
  it('serializes concurrent admissions and commits with contiguous admission sequence', async () => {
    const f = fixture(); const observer = await f.open();
    await Promise.all(['one', 'two'].map(call => observer.admit(admission(call))));
    await Promise.all(['one', 'two'].map(call => observer.resolvedDispatch!(f.resolved(call))));
    await Promise.all(['two', 'one'].map(call => observer.commit(f.saveResult(call))));
    await observer.drain(identity);
    const inventory = f.state().evidenceInventory;
    expect(inventory?.schemaVersion === 2 && inventory.provenance.checkpoint.admissions.map(call => call.sequence)).toEqual([1, 2]);
  });
  it('rejects replay instead of repeating a persisted admission', async () => {
    const f = fixture(); const observer = await f.open(); await observer.admit(admission());
    await expect(observer.admit(admission())).rejects.toThrow('GOAL_RECEIPT');
    expect(f.events().filter(event => event.data.phase === 'admitted')).toHaveLength(1);
  });

  it.each(['before_ack', 'after_ack', 'after_cas_ack'] as const)('detects policy/state mutation %s and poisons without retry', async timing => {
    const f = fixture(); const observer = await f.open(); const required = f.audit.logRequired.bind(f.audit);
    f.ports.audit = { logRequired: async (id, event) => {
      const mutate = () => { const current = f.state(); f.repository.compareAndSwap(run.id, current.stateRevision, { rootSessionId: 'root', packet: current.packet, updatedAt: Date.now() }); };
      if (event.data.phase === 'admitted' && timing === 'before_ack') mutate();
      await required(id, event);
      if (event.data.phase === 'admitted' && timing === 'after_ack') mutate();
      if (event.data.phase === 'cas_ack' && event.data.forPhase === 'admitted' && timing === 'after_cas_ack') mutate();
    } };
    await expect(observer.admit(admission())).rejects.toThrow('GOAL_RECEIPT');
    await expect(observer.admit(admission('retry'))).rejects.toThrow('GOAL_RECEIPT');
    expect(f.events().filter(event => event.data.phase === 'admitted')).toHaveLength(1);
  });
  it.each(['source', 'scope', 'registry'] as const)('detects changed %s authority during audit wait', async mode => {
    const f = fixture(); const observer = await f.open(); const required = f.audit.logRequired.bind(f.audit);
    f.ports.audit = { logRequired: async (id, event) => {
      await required(id, event);
      if (event.data.phase !== 'admitted') return;
      if (mode === 'source') f.client.exec("UPDATE messages SET content = 'changed' WHERE id = 'source'");
      if (mode === 'scope') f.client.prepare('UPDATE fixture_registered_scope SET snapshot = ?').run(JSON.stringify({ ...f.scope, canonicalCwd: 'E:\\project\\other' }));
      if (mode === 'registry') f.ports.registry = { snapshot: () => [] };
    } };
    await expect(observer.admit(admission())).rejects.toThrow('GOAL_RECEIPT');
    expect(f.events().some(event => event.data.phase === 'resolved')).toBe(false);
  });
  it('does not retry an audit failure or accept more work afterward', async () => {
    const f = fixture(); const observer = await f.open(); f.client.exec('DROP TABLE audit_log');
    await expect(observer.admit(admission())).rejects.toThrow('GOAL_RECEIPT');
    const revision = f.state().stateRevision; await expect(observer.admit(admission('retry'))).rejects.toThrow('GOAL_RECEIPT');
    expect(f.state().stateRevision).toBe(revision);
  });
  it('rejects aborted creation and abort during required audit ACK', async () => {
    const first = fixture(); first.controller.abort(); await expect(first.open()).rejects.toThrow('GOAL_RECEIPT');
    const f = fixture(); const observer = await f.open(); const required = f.audit.logRequired.bind(f.audit);
    f.ports.audit = { logRequired: async (id, event) => { await required(id, event); f.controller.abort(); } };
    await expect(observer.admit(admission())).rejects.toThrow('GOAL_RECEIPT');
    expect(f.state().stateRevision).toBe(2);
  });
  it.each(['missing', 'revision', 'terminal', 'not_drained'] as const)('rejects journal %s without sealing', async mode => {
    const f = fixture(); const observer = await f.open(); await executed(f, observer);
    if (mode !== 'not_drained') await observer.drain(identity);
    if (mode !== 'missing') f.saveJournal();
    const ack = completed(); if (mode === 'revision') ack.revision = 8; if (mode === 'terminal') ack.outcome.messageId = 'foreign';
    await expect(observer.journalComplete(identity, ack)).rejects.toThrow('GOAL_RECEIPT');
    const inventory = f.state().evidenceInventory;
    expect(inventory?.schemaVersion === 2 && inventory.provenance.checkpoint.status).toBe('open');
    if (mode !== 'missing') expect(f.client.prepare('SELECT status FROM chat_runs').get()).toEqual({ status: 'completed' });
  });
  it('rejects argument getters before invocation and leaves no raw data in errors', async () => {
    const f = fixture(); const observer = await f.open(); let invoked = 0;
    const args = Object.defineProperty({}, 'secret', { enumerable: true, get() { invoked++; return 'SECRET'; } });
    await expect(observer.admit({ ...admission(), args })).rejects.toThrow(/^GOAL_RECEIPT_FAILED$/); expect(invoked).toBe(0);
  });
  it('captures admitted post-transform arguments before the first await', async () => {
    const f = fixture(); const observer = await f.open(); const call = admission(); const args = { ...call.args };
    const pending = observer.admit({ ...call, args }); args.token = 'CHANGED-AFTER-DELIVERY'; await pending;
    await expect(observer.resolvedDispatch!(f.resolved())).resolves.toBeUndefined();
  });
  it('records a real HITL result ACK after cancellation before executor entry without resolved authority', async () => {
    const f = fixture(); const observer = await f.open(); await observer.admit(admission());
    await f.hitl.create({ id: 'cancel-confirmation', kind: 'tool_confirmation', sessionId: 'branch', payload: {}, continuation: { executionState: 'pending' } });
    await f.hitl.resolve('cancel-confirmation', 1, 'approved'); await f.hitl.claimApprovedContinuation('cancel-confirmation', 2);
    const commit = f.saveResult('call', 'cancelled', 'cancelled', null);
    commit.registeredCommitAck = 'acknowledged';
    commit.hitlCommit = await f.hitl.markContinuationToolResultRequired('cancel-confirmation', 3, { status: 'cancelled' });
    await observer.commit(commit); await observer.drain(identity);
    expect(f.events().find(event => event.data.phase === 'committed')?.data).toMatchObject({ resolved: null,
      hitlCommit: { requestId: 'cancel-confirmation', resultStatus: 'cancelled' } });
    expect(f.state().evidenceInventory?.host.evidenceById).toEqual({});
  });
  it.each(['parentSessionId', 'rootSessionId', 'branchSessionId', 'projectId', 'executionProfileId', 'canonicalProjectRoot', 'canonicalCwd'] as const)(
    'rejects stale persisted %s scope after opening', async field => {
      const f = fixture(); const observer = await f.open();
      f.client.prepare('UPDATE fixture_registered_scope SET snapshot = ?').run(JSON.stringify({ ...f.scope, [field]: 'foreign' }));
      await expect(observer.admit(admission())).rejects.toThrow('GOAL_RECEIPT');
      expect(f.events().filter(event => event.data.phase === 'admitted')).toHaveLength(0);
    });
  it.each(['symbol', 'hidden', 'sparse', 'array_extra', 'array_proto', 'proxy'] as const)('rejects descriptor-unsafe %s arguments without traps', async mode => {
    const f = fixture(); const observer = await f.open(); let traps = 0; const base: Record<string, unknown> = { path: 'src' };
    if (mode === 'symbol') Reflect.set(base, Symbol('extra'), 1);
    if (mode === 'hidden') Object.defineProperty(base, 'extra', { value: 1 });
    if (mode === 'sparse') base.values = Array(1);
    if (mode === 'array_extra') base.values = Object.assign([1], { extra: 1 });
    if (mode === 'array_proto') base.values = Object.setPrototypeOf([1], null);
    const args = mode === 'proxy' ? new Proxy(base, { ownKeys(target) { traps++; return Reflect.ownKeys(target); } }) : base;
    await expect(observer.admit({ ...admission(), args })).rejects.toThrow('GOAL_RECEIPT'); expect(traps).toBe(0);
  });
  it('detects canonical scope mutation while the persisted source reader is awaiting', async () => {
    const f = fixture(); const observer = await f.open(); const read = f.ports.sourceReader.read.bind(f.ports.sourceReader);
    f.ports.sourceReader = { read: async locator => { const source = await read(locator);
      f.client.prepare('UPDATE fixture_registered_scope SET snapshot = ?').run(JSON.stringify({ ...f.scope, canonicalProjectRoot: 'E:\\other' })); return source; } };
    await expect(observer.admit(admission())).rejects.toThrow('GOAL_RECEIPT');
    expect(f.events().filter(event => event.data.phase === 'admitted')).toHaveLength(0);
  });
  it('rejects result content changed during the committed phase ACK', async () => {
    const f = fixture(); const observer = await f.open(); await observer.admit(admission()); await observer.resolvedDispatch!(f.resolved());
    const commit = f.saveResult(); const required = f.audit.logRequired.bind(f.audit);
    f.ports.audit = { logRequired: async (id, event) => { await required(id, event);
      if (event.data.phase === 'committed') f.client.exec("UPDATE messages SET content = 'tampered' WHERE id = 'result-call'"); } };
    await expect(observer.commit(commit)).rejects.toThrow('GOAL_RECEIPT');
    await expect(observer.drain(identity)).rejects.toThrow('GOAL_RECEIPT');
  });
  it('rejects actual journal changed during verified phase ACK without overwriting completed status', async () => {
    const f = fixture(); const observer = await f.open(); await executed(f, observer); await observer.drain(identity); f.saveJournal();
    const required = f.audit.logRequired.bind(f.audit);
    f.ports.audit = { logRequired: async (id, event) => { await required(id, event);
      if (event.data.phase === 'journal_verified') f.client.exec('UPDATE chat_runs SET revision = 8'); } };
    await expect(observer.journalComplete(identity, completed())).rejects.toThrow('GOAL_RECEIPT');
    expect(f.client.prepare('SELECT status FROM chat_runs').get()).toEqual({ status: 'completed' });
  });
});
