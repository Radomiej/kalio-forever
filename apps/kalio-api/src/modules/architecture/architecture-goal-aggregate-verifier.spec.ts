import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { TerminalChatRunRecord, WorkflowEvidence } from '@kalio/types';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { AuditService } from '../chat/audit.service';
import { PersistedRuntimeEvidenceReader } from '../chat/persisted-runtime-evidence-reader';
import { createGoalPacket } from './architecture-goal-source';
import { acceptGoalProjection, prepareGoalProjection, goalProjectionPolicyTargets } from './architecture-goal-projection';
import { ArchitectureGoalRepository, type ArchitectureGoalState } from './architecture-goal.repository';
import type { GoalEvidenceInventoryV2 } from './architecture-goal-completion-state';
import { ArchitectureGoalAggregateVerifier, type GoalAggregateV1, type GoalAggregateVerifierPorts,
  type GoalDurableDispatchFacts, type GoalDurableHitlRow, type GoalEvidenceProjection, type GoalTerminalOutputLink } from './architecture-goal-aggregate-verifier';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(db => db.close()));
async function fixture(terminalStatus?: 'failed' | 'cancelled' | 'interrupted') {
  const db = new Database(':memory:'); clients.push(db);
  db.exec(`CREATE TABLE audit_log(id TEXT PRIMARY KEY,session_id TEXT,type TEXT NOT NULL,label TEXT NOT NULL,
    data TEXT,duration_ms INTEGER,chunk_count INTEGER,created_at INTEGER NOT NULL);
    CREATE TABLE audit_log_archive(id TEXT PRIMARY KEY,session_id TEXT,type TEXT NOT NULL,label TEXT NOT NULL,
    data TEXT,duration_ms INTEGER,chunk_count INTEGER,created_at INTEGER NOT NULL,archived_at INTEGER NOT NULL);
    CREATE TABLE messages(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      turn_id TEXT, prompt_message_id TEXT, tool_call_id TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE chat_runs(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,turn_id TEXT NOT NULL,phase TEXT NOT NULL,
      status TEXT NOT NULL,revision INTEGER NOT NULL,outcome TEXT,completed_at INTEGER,updated_at INTEGER NOT NULL);
    CREATE TABLE architecture_goal_states(run_id TEXT PRIMARY KEY,root_session_id TEXT NOT NULL,state_revision INTEGER NOT NULL,
      source_version INTEGER NOT NULL,projection_status TEXT NOT NULL,source_fingerprint TEXT NOT NULL,goal_fingerprint TEXT,
      packet_json TEXT NOT NULL,evidence_inventory_json TEXT,completion_authorization_json TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);`);
  const connection = { db: drizzle(db, { schema }) } as unknown as DrizzleService;
  const audit = new AuditService(connection), reader = new PersistedRuntimeEvidenceReader(connection);
  const pending = createGoalPacket({ messageId: 'user', sessionId: 'human-host', turnId: 'human-turn', content: 'Read project', createdAt: 1 });
  const proposal = prepareGoalProjection(pending, { sourceVersion: 1, criteria: [{ text: 'Read project',
    sourceQuotes: [{ messageId: 'user', quote: 'Read project' }], supersedes: [] }] });
  pending.projection = { status: 'pending', base: null, proposal };
  const criterion = goalProjectionPolicyTargets(pending, proposal)[0]!.id;
  const packet = acceptGoalProjection(pending, proposal, { requiredEvidenceKindsByCriterion: { [criterion]: ['VFS_READ'] } },
    { sourceVersion: 1, sourceFingerprint: pending.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
  if (packet.projection.status !== 'accepted') throw new Error('fixture');
  const identity = { runId: 'chat-journal', sessionId: 'branch', turnId: 'tool-turn', promptMessageId: 'tool-prompt' };
  const scope = { rootSessionId: 'root', branchSessionId: 'branch', projectId: 'project', executionProfileId: 'profile',
    parentSessionId: 'root', canonicalProjectRoot: 'E:\\project', canonicalCwd: 'E:\\project' };
  db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('result', 'branch', 'tool_result', '{"text":"hello"}', 'tool-turn', 'tool-prompt', 'call', 2);
  db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('terminal', 'branch', 'assistant', 'Finished', 'tool-turn', 'tool-prompt', null, 4);
  db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('tool-prompt', 'branch', 'user', 'Read project', 'tool-turn', 'tool-prompt', null, 1);
  db.prepare('INSERT INTO chat_runs VALUES (?,?,?,?,?,?,?,?,?)').run('chat-journal', 'branch', 'tool-turn',
    terminalStatus === 'cancelled' || terminalStatus === 'interrupted' ? 'interrupted' : terminalStatus ?? 'completed', terminalStatus ?? 'completed',
    4, terminalStatus ? null : '{"messageId":"terminal"}', terminalStatus ? null : 4, 4);
  const result = (await reader.readToolResultExact({ messageId: 'result', sessionId: 'branch', turnId: 'tool-turn', promptMessageId: 'tool-prompt',
    toolCallId: 'call', role: 'tool_result' }))!;
  const journal = { chatRunId: 'chat-journal', sessionId: 'branch', turnId: 'tool-turn', revision: 4, phase: 'completed' as const,
    status: 'completed' as const, completedAt: 4, updatedAt: 4, terminalMessageId: 'terminal', promptMessageId: 'tool-prompt' };
  const failedJournal: TerminalChatRunRecord | null = terminalStatus ? (await reader.readTerminalRunExact({ chatRunId: 'chat-journal',
    sessionId: 'branch', turnId: 'tool-turn', promptMessageId: 'tool-prompt', revision: 4, status: terminalStatus,
    phase: terminalStatus === 'failed' ? 'failed' : 'interrupted', outcomeMessageId: null })) : null;
  const facts: GoalDurableDispatchFacts = { identity, callId: 'call', requestedName: 'vfs_read', argsSha256: 'b'.repeat(64),
    canonicalName: 'vfs_read', target: 'kalio_registry', approval: { kind: 'non_durable', reason: 'not_required' }, hitlCommit: null,
    resultMessageId: 'result', resultStatus: 'success', contentSha256: result.contentSha256 };
  let evidence: WorkflowEvidence = { kind: 'VFS_READ', status: 'passed', source: 'result' };
  const metadata = { schemaVersion: 1, attemptId: 'attempt', architectureRunId: 'run', rootSessionId: 'root', schemaId: 'schema',
    goalVersion: 1, sourceFingerprint: packet.sourceFingerprint, goalFingerprint: packet.projection.snapshot.goalFingerprint, scope };
  const resolved = { identity, callId: 'call', requestedName: 'vfs_read', canonicalName: 'vfs_read', argsSha256: facts.argsSha256,
    target: { kind: 'kalio_registry', requiresConfirmation: false }, approval: facts.approval };
  const steps = [
    { phase: 'opened', allowedToolNames: ['vfs_read'] },
    { phase: 'admitted', identity, callId: 'call', requestedName: 'vfs_read', argsSha256: facts.argsSha256, sequence: 1 },
    { phase: 'resolved', identity, callId: 'call', resolved },
    { phase: 'committed', identity, callId: 'call', requestedName: 'vfs_read', argsSha256: facts.argsSha256, sequence: 1,
      resolved, status: 'success', result: { ...result, content: undefined }, hitlCommit: null },
    { phase: 'drained', identity, admittedCount: 1, committedCount: 1 },
    { phase: terminalStatus ? 'journal_terminal_verified' : 'journal_verified', identity, journal: failedJournal ?? journal },
  ];
  // Exact producer-shaped durable audit leaves; fixture authority is NOT production dispatch proof.
  Reflect.deleteProperty(steps[3]!.result!, 'content');
  const sealedRevision = steps.length + 2;
  const refs = [];
  let previous: string | null = null;
  for (const [i, step] of steps.entries()) {
    const name = step.phase === 'opened' ? 'open' : step.phase === 'resolved' ? 'resolved' : String(['admitted', 'committed', 'drained', 'journal_verified', 'journal_terminal_verified'].indexOf(step.phase) >= 4 ? 3 : ['admitted', 'committed', 'drained', 'journal_verified'].indexOf(step.phase));
    const phaseId = `phase-${name}`, anchorId = `anchor-${name}`, ackId = `ack-${name}`;
    const phaseData = { ...metadata, recordType: 'phase', phaseSequence: i + 1, expectedStateRevision: i + 1,
      previousCheckpointId: previous, ...step };
    const entries = [
      { id: phaseId, label: `goal_receipt:${step.phase}`, data: phaseData },
      { id: anchorId, label: 'goal_receipt:inventory_anchor', data: { ...metadata, recordType: 'inventory_anchor', phaseEventId: phaseId,
        previousCheckpointId: previous, expectedStateRevision: i + 1 } },
      { id: ackId, label: 'goal_receipt:cas_ack', data: { ...metadata, recordType: 'cas_ack', phaseEventId: phaseId,
        inventoryCheckpointId: anchorId, stateRevision: i + 2 } },
    ];
    const pointers = [];
    for (const entry of entries) {
      await audit.logRequired(entry.id, { sessionId: 'root', type: 'architecture_event', label: entry.label, data: entry.data });
      const row = await audit.readGoalProofExact({ id: entry.id, runId: 'run', rootSessionId: 'root', label: entry.label });
      pointers.push({ id: row.id, runId: 'run', rootSessionId: 'root', label: row.label, expectedDataSha256: row.dataSha256 });
    }
    refs.push({ phase: pointers[0]!, anchor: pointers[1]!, ack: pointers[2]! }); previous = anchorId;
  }
  const aggregate: GoalAggregateV1 = { schemaVersion: 1, recordType: 'goal_completion_aggregate', runId: 'run', rootSessionId: 'root',
    eventId: 'aggregate-event', sequence: 5, goalVersion: 1, sourceFingerprint: packet.sourceFingerprint,
    goalFingerprint: packet.projection.snapshot.goalFingerprint, inventoryStateRevision: sealedRevision, sealCheckpointId: 'seal',
    completionPolicy: packet.completionPolicy, buildExpectation: null,
    attempts: [{ attemptId: 'attempt', role: 'worker', identity, scope, previousCheckpointId: null,
      phases: refs, terminal: failedJournal ? { kind: 'terminal', record: failedJournal } : { kind: 'completed', record: journal },
      admissions: [{ callId: 'call', originalSequence: 1, globalSequence: 1 }] }], selectedBuildCallId: null,
    supersededEvidenceIds: {} };
  const proof = await audit.logContentAddressedGoalAggregateRequired({ sessionId: 'root', type: 'architecture_event',
    label: 'goal_completion:aggregate', data: aggregate as unknown as Record<string, unknown> });
  const inventory: GoalEvidenceInventoryV2 = { schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: 1,
    sourceFingerprint: packet.sourceFingerprint, inventoryStateRevision: sealedRevision,
    host: { evidenceById: { read: evidence }, cliChildrenById: {} },
    provenance: { schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: 1, sourceFingerprint: packet.sourceFingerprint,
      goalFingerprint: packet.projection.snapshot.goalFingerprint, checkpoint: { checkpointId: 'seal', status: 'sealed',
        admissions: [{ callId: 'call', sessionId: 'branch', turnId: 'tool-turn', promptMessageId: 'tool-prompt', sequence: 1, admissionCheckpointId: 'phase-0' }],
        commits: [{ callId: 'call', sequence: 1, commitCheckpointId: 'phase-1', resultMessageId: 'result', status: 'success' }],
        completedRunJournalRef: { checkpointId: proof.id, eventId: 'aggregate-event', sequence: 5 } },
      evidenceRefsById: { read: { checkpointId: 'phase-1', eventId: 'phase-1', sequence: 1, evidenceIndex: 0, dispatchCallId: 'call' } },
      childRefsById: {}, supersededEvidenceIds: {}, buildExpectation: null } };
  await audit.logRequired('seal', { sessionId: 'root', type: 'architecture_event', label: 'goal_completion:sealed',
    data: { runId: 'run', rootSessionId: 'root', aggregateId: proof.id, inventoryStateRevision: sealedRevision } });
  let state: ArchitectureGoalState = { runId: 'run', rootSessionId: 'root', stateRevision: sealedRevision, packet, createdAt: 1, updatedAt: sealedRevision,
    evidenceInventory: inventory, completionAuthorization: null };
  const repository = new ArchitectureGoalRepository(connection);
  const storeState = () => db.prepare('INSERT OR REPLACE INTO architecture_goal_states VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
    state.runId, state.rootSessionId, state.stateRevision, state.packet.version, state.packet.projection.status, state.packet.sourceFingerprint,
    state.packet.projection.status === 'accepted' ? state.packet.projection.snapshot.goalFingerprint : null,
    JSON.stringify(state.packet), JSON.stringify(state.evidenceInventory), state.completionAuthorization === null ? null : JSON.stringify(state.completionAuthorization),
    state.createdAt, state.updatedAt);
  storeState();
  db.exec('CREATE TABLE fixture_projections(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE fixture_output_link(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
  const proofScope = () => ({ runId: 'run', rootSessionId: 'root', goalVersion: 1, sourceFingerprint: packet.sourceFingerprint,
    goalFingerprint: packet.projection.status === 'accepted' ? packet.projection.snapshot.goalFingerprint : '', inventoryStateRevision: inventory.inventoryStateRevision });
  const saveProjection = (projection: GoalEvidenceProjection) => db.prepare('INSERT OR REPLACE INTO fixture_projections VALUES (?,?)').run(projection.evidenceId, JSON.stringify(projection));
  saveProjection({ scope: proofScope(), evidenceId: 'read', ref: structuredClone(inventory.provenance.evidenceRefsById.read!),
    dispatch: { identity, callId: 'call' }, resultMessageId: 'result', evidence });
  const restampProjections = () => {
    const rows = db.prepare('SELECT id,data FROM fixture_projections').all() as { id: string; data: string }[];
    for (const row of rows) saveProjection({ ...JSON.parse(row.data) as GoalEvidenceProjection, scope: proofScope() });
  };
  const ports: GoalAggregateVerifierPorts = { repository, audit,
    durableReader: reader,
    sourceReader: { read: async () => structuredClone(packet.original) },
    persistedScope: { readRegisteredScope: async () => structuredClone(scope) },
    authority: { readDispatchExact: async () => structuredClone(facts), readHitlExact: async () => null, readChildExact: async () => null,
      readTerminalOutputLinkExact: async () => {
        const row = db.prepare('SELECT data FROM fixture_output_link WHERE id=?').get('call') as { data: string } | undefined;
        return row ? JSON.parse(row.data) as GoalTerminalOutputLink : null;
      },
      readEvidenceProjectionExact: async (_scope, id) => {
        const row = db.prepare('SELECT data FROM fixture_projections WHERE id=?').get(id) as { data: string } | undefined;
        return row ? JSON.parse(row.data) as GoalEvidenceProjection : null;
      } } };
  const republish = async (raw: GoalAggregateV1 = aggregate) => {
    const proof = await audit.logContentAddressedGoalAggregateRequired({ sessionId: 'root', type: 'architecture_event',
      label: 'goal_completion:aggregate', data: raw as unknown as Record<string, unknown> });
    Reflect.set(inventory.provenance.checkpoint, 'completedRunJournalRef', { checkpointId: proof.id, eventId: raw.eventId, sequence: raw.sequence });
    db.prepare("UPDATE audit_log SET data=? WHERE id='seal'").run(JSON.stringify({ runId: 'run', rootSessionId: 'root', aggregateId: proof.id, inventoryStateRevision: raw.inventoryStateRevision }));
    storeState();
  };
  const refreshLeaves = async () => {
    for (const step of aggregate.attempts[0]!.phases) for (const ref of Object.values(step)) {
      const row = await audit.readGoalProofExact({ id: ref.id, runId: 'run', rootSessionId: 'root', label: ref.label });
      Reflect.set(ref, 'expectedDataSha256', row.dataSha256);
    }
    await republish();
  };
  const enableBuild = async (withOutput = true) => {
    const expectation = { approvedSource: { messageId: 'user', sessionId: 'human-host', turnId: 'human-turn' },
      executable: 'npm', args: ['run', 'build'], canonicalCwd: 'E:\\project' };
    Reflect.set(state.packet.completionPolicy.requiredEvidenceKindsByCriterion, criterion, ['BUILD_RESULT']);
    Reflect.set(aggregate, 'completionPolicy', state.packet.completionPolicy);
    Reflect.set(aggregate, 'buildExpectation', expectation); Reflect.set(inventory.provenance, 'buildExpectation', expectation);
    Reflect.set(aggregate, 'selectedBuildCallId', 'call'); Reflect.set(aggregate.attempts[0]!, 'role', 'host_build');
    Reflect.set(facts, 'canonicalName', 'terminal_spawn'); Reflect.set(facts, 'requestedName', 'terminal_spawn');
    const receipt = { requestId: 'hitl', claimedRevision: 3, committedRevision: 4, status: 'approved' as const,
      executionState: 'tool_result_committed' as const, resultStatus: 'success' as const };
    Reflect.set(facts, 'hitlCommit', receipt); Reflect.set(facts, 'approval', { kind: 'durable_confirmation', requestId: 'hitl', claimedRevision: 3 });
    evidence = { kind: 'BUILD_RESULT', status: 'passed', source: 'result', data: { exitCode: 0 } };
    Reflect.set(inventory.host.evidenceById, 'read', evidence);
    saveProjection({ scope: proofScope(), evidenceId: 'read', ref: structuredClone(inventory.provenance.evidenceRefsById.read!),
      dispatch: { identity, callId: 'call' }, resultMessageId: 'result', evidence });
    const row: GoalDurableHitlRow = { id: 'hitl', revision: 4, status: 'approved', executionState: 'tool_result_committed',
      sessionId: 'branch', turnId: 'tool-turn', runId: 'chat-journal', toolCallId: 'call', outcome: { status: 'success' },
      continuation: { promptMessageId: 'tool-prompt', hostConfirmationRequirement: { kind: 'human_only', toolName: 'terminal_spawn', callId: 'call' },
        approvalOrigin: { schemaVersion: 1, kind: 'gateway_tool_confirm', requestId: 'hitl', sessionId: 'branch', toolCallId: 'call', socketId: 'socket', approvedFromRevision: 1 } } };
    // SQL-backed fixture authority readback, not a gateway authentication claim.
    db.exec('CREATE TABLE fixture_hitl(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
    db.prepare('INSERT INTO fixture_hitl VALUES (?,?)').run('hitl', JSON.stringify(row));
    ports.authority.readHitlExact = async id => {
      const stored = db.prepare('SELECT data FROM fixture_hitl WHERE id=?').get(id) as { data: string } | undefined;
      return stored ? JSON.parse(stored.data) as GoalDurableHitlRow : null;
    };
    for (const id of ['phase-open', 'phase-0', 'phase-resolved', 'phase-1']) {
      const stored = db.prepare('SELECT data FROM audit_log WHERE id=?').get(id) as { data: string };
      const value = JSON.parse(stored.data) as Record<string, unknown>;
      if (id === 'phase-open') value.allowedToolNames = ['terminal_spawn'];
      else if (id !== 'phase-resolved') value.requestedName = 'terminal_spawn';
      if (id === 'phase-1' || id === 'phase-resolved') value.resolved = { ...resolved, requestedName: 'terminal_spawn',
        canonicalName: 'terminal_spawn', target: { kind: 'kalio_registry', requiresConfirmation: true }, approval: facts.approval };
      if (id === 'phase-1') value.hitlCommit = receipt;
      db.prepare('UPDATE audit_log SET data=? WHERE id=?').run(JSON.stringify(value), id);
    }
    await refreshLeaves();
    if (withOutput) {
      const descriptor = { terminalId: 'process', executable: 'npm', argv: ['run', 'build'], actualCwd: 'E:\\project', shell: false,
        ownerIdentity: { sessionId: 'branch', turnId: 'tool-turn', callId: 'call' } };
      db.prepare("UPDATE messages SET content=? WHERE id='result'").run(JSON.stringify({ id: 'process', pid: 123, command: 'npm run build', executionDescriptor: descriptor }));
      const spawnResult = (await reader.readToolResultExact({ messageId: 'result', sessionId: 'branch', turnId: 'tool-turn', promptMessageId: 'tool-prompt', toolCallId: 'call', role: 'tool_result' }))!;
      Reflect.set(facts, 'contentSha256', spawnResult.contentSha256);
      const { content: _s, ...spawnMetadata } = spawnResult;
      const spawnCommit = JSON.parse((db.prepare("SELECT data FROM audit_log WHERE id='phase-1'").get() as { data: string }).data) as Record<string, unknown>;
      spawnCommit.result = spawnMetadata;
      db.prepare("UPDATE audit_log SET data=? WHERE id='phase-1'").run(JSON.stringify(spawnCommit));
      await refreshLeaves();
      const outputIdentity = { runId: 'output-journal', sessionId: 'branch', turnId: 'output-turn', promptMessageId: 'output-prompt' };
      db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('output-prompt', 'branch', 'user', 'Observe build', 'output-turn', 'output-prompt', null, 10);
      db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('output-result', 'branch', 'tool_result',
        JSON.stringify({ id: 'process', status: 'exited', exitCode: 0, output: 'ok', executionDescriptor: descriptor }), 'output-turn', 'output-prompt', 'output-call', 11);
      db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('output-terminal', 'branch', 'assistant', 'Done', 'output-turn', 'output-prompt', null, 12);
      db.prepare('INSERT INTO chat_runs VALUES (?,?,?,?,?,?,?,?,?)').run('output-journal', 'branch', 'output-turn', 'completed', 'completed', 4, '{"messageId":"output-terminal"}', 12, 12);
      const outputJournal = (await reader.readCompletedRunExact({ chatRunId: 'output-journal', sessionId: 'branch', turnId: 'output-turn', promptMessageId: 'output-prompt', terminalMessageId: 'output-terminal', revision: 4 }))!;
      const outputResult = (await reader.readToolResultExact({ messageId: 'output-result', sessionId: 'branch', turnId: 'output-turn', promptMessageId: 'output-prompt', toolCallId: 'output-call', role: 'tool_result' }))!;
      const outputFacts: GoalDurableDispatchFacts = { ...facts, identity: outputIdentity, callId: 'output-call', requestedName: 'terminal_output', canonicalName: 'terminal_output',
        approval: { kind: 'non_durable', reason: 'not_required' }, hitlCommit: null, resultMessageId: 'output-result', contentSha256: outputResult.contentSha256 };
      const { content: _o, ...outputMetadata } = outputResult;
      const outputPhases = [];
      let previous = 'anchor-3';
      for (const [i, step] of aggregate.attempts[0]!.phases.entries()) {
        const pointers = [];
        for (const [kind, pointer] of Object.entries(step)) {
          const data = JSON.parse((db.prepare('SELECT data FROM audit_log WHERE id=?').get(pointer.id) as { data: string }).data) as Record<string, unknown>;
          data.attemptId = 'output-attempt';
          if (Object.hasOwn(data, 'identity')) data.identity = outputIdentity;
          if (kind === 'phase') {
            data.expectedStateRevision = i + 7; data.previousCheckpointId = previous;
            if (Object.hasOwn(data, 'callId')) data.callId = 'output-call';
            if (Object.hasOwn(data, 'requestedName')) data.requestedName = 'terminal_output';
            if (data.phase === 'opened') data.allowedToolNames = ['terminal_output'];
            if (data.phase === 'journal_verified') data.journal = outputJournal;
            if (objectForTest(data.resolved)) data.resolved = { ...data.resolved, identity: outputIdentity, callId: 'output-call', requestedName: 'terminal_output', canonicalName: 'terminal_output',
              target: { kind: 'kalio_registry', requiresConfirmation: false }, approval: outputFacts.approval };
            if (data.phase === 'committed') { data.result = outputMetadata; data.hitlCommit = null; }
          } else if (kind === 'anchor') {
            data.expectedStateRevision = i + 7; data.previousCheckpointId = previous; data.phaseEventId = `output-${step.phase.id}`;
          } else {
            data.stateRevision = i + 8; data.phaseEventId = `output-${step.phase.id}`; data.inventoryCheckpointId = `output-${step.anchor.id}`;
          }
          const id = `output-${pointer.id}`;
          await audit.logRequired(id, { sessionId: 'root', type: 'architecture_event', label: pointer.label, data });
          const row = await audit.readGoalProofExact({ id, runId: 'run', rootSessionId: 'root', label: pointer.label });
          pointers.push({ id, runId: 'run', rootSessionId: 'root', label: pointer.label, expectedDataSha256: row.dataSha256 });
        }
        outputPhases.push({ phase: pointers[0]!, anchor: pointers[1]!, ack: pointers[2]! }); previous = `output-${step.anchor.id}`;
      }
      Reflect.set(aggregate, 'attempts', [...aggregate.attempts, { ...aggregate.attempts[0]!, attemptId: 'output-attempt', identity: outputIdentity,
        previousCheckpointId: 'anchor-3', phases: outputPhases, terminal: { kind: 'completed', record: outputJournal },
        admissions: [{ callId: 'output-call', originalSequence: 1, globalSequence: 2 }] }]);
      Reflect.set(aggregate, 'inventoryStateRevision', 14); Reflect.set(inventory, 'inventoryStateRevision', 14);
      state = { ...state, stateRevision: 14, updatedAt: 14 };
      Reflect.set(inventory.provenance.checkpoint, 'admissions', [...inventory.provenance.checkpoint.admissions,
        { callId: 'output-call', sessionId: 'branch', turnId: 'output-turn', promptMessageId: 'output-prompt', sequence: 2, admissionCheckpointId: 'output-phase-0' }]);
      Reflect.set(inventory.provenance.checkpoint, 'commits', [...inventory.provenance.checkpoint.commits,
        { callId: 'output-call', sequence: 2, commitCheckpointId: 'output-phase-1', resultMessageId: 'output-result', status: 'success' }]);
      const outputRef = { checkpointId: 'output-phase-1', eventId: 'output-phase-1', sequence: 2, evidenceIndex: 0, dispatchCallId: 'output-call' };
      Reflect.set(inventory.provenance.evidenceRefsById, 'read', outputRef);
      saveProjection({ scope: proofScope(), evidenceId: 'read', ref: outputRef, dispatch: { identity: outputIdentity, callId: 'output-call' }, resultMessageId: 'output-result', evidence });
      const link: GoalTerminalOutputLink = { scope: proofScope(), spawn: { identity, callId: 'call' }, output: { identity: outputIdentity, callId: 'output-call' }, terminalId: 'process', owner: descriptor.ownerIdentity,
        approvedCommand: { approvedSource: expectation.approvedSource, executable: 'npm', argv: ['run', 'build'], canonicalCwd: 'E:\\project', shell: false }, status: 'exited', exitCode: 0 };
      db.prepare('INSERT INTO fixture_output_link VALUES (?,?)').run('call', JSON.stringify(link));
      ports.authority.readDispatchExact = async (key, callId) => callId === 'call' && key.runId === identity.runId ? structuredClone(facts)
        : callId === 'output-call' && key.runId === outputIdentity.runId ? structuredClone(outputFacts) : null;
      await republish();
    }
    return row;
  };
  return { db, audit, aggregate, inventory, facts, ports, republish, refreshLeaves, enableBuild, repository,
    state: () => { storeState(); return repository.load('run', 'root')!; },
    mutateState: () => { state = { ...state, stateRevision: state.stateRevision + 1 }; storeState(); },
    saveProjection, proofScope,
    setRevision: (revision: number) => { state = { ...state, stateRevision: revision, updatedAt: revision }; restampProjections(); storeState(); },
    service: () => new ArchitectureGoalAggregateVerifier(ports) };
}

describe('aggregate leaf verifier (SQLite audit, explicit fixture authority; not live trust)', () => {
  it('resolves every leaf without assuming source session equals internal root', async () => {
    const f = await fixture(); await expect(f.service().verifyDurableInventory(f.state())).resolves.toBeUndefined();
  });
  it.each(['missing', 'tampered', 'foreign'])('rejects %s aggregate', async mode => {
    const f = await fixture();
    if (mode === 'missing') f.db.exec("DELETE FROM audit_log WHERE label='goal_completion:aggregate'");
    else f.db.exec(`UPDATE audit_log SET ${mode === 'tampered' ? "data='{}'" : "session_id='foreign'"} WHERE label='goal_completion:aggregate'`);
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it.each(['authority', 'result', 'journal', 'source', 'scope', 'evidence'])('rejects mismatched durable %s', async mode => {
    const f = await fixture();
    if (mode === 'authority') f.ports.authority.readDispatchExact = async () => null;
    if (mode === 'result') f.ports.durableReader.readToolResultExact = async () => null;
    if (mode === 'journal') f.ports.durableReader.readCompletedRunExact = async () => null;
    if (mode === 'source') f.ports.sourceReader.read = async () => null;
    if (mode === 'scope') f.ports.persistedScope.readRegisteredScope = async () => ({ ...f.aggregate.attempts[0]!.scope, canonicalCwd: 'E:\\foreign' });
    if (mode === 'evidence') f.db.exec('DELETE FROM fixture_projections');
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it('rereads current repository after authority await', async () => {
    const f = await fixture(); f.ports.authority.readDispatchExact = async () => { f.mutateState(); return structuredClone(f.facts); };
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it('returns static cancellation before and during a reader', async () => {
    const f = await fixture(); const controller = new AbortController(); controller.abort(new Error('PRIVATE_SECRET'));
    await expect(f.service().verifyDurableInventory(f.state(), controller.signal)).rejects.toThrow(/^GOAL_AGGREGATE_ABORTED$/);
    const later = new AbortController(); f.ports.authority.readDispatchExact = async () => { later.abort('PRIVATE_SECRET'); throw new Error('PRIVATE_DRIVER'); };
    await expect(f.service().verifyDurableInventory(f.state(), later.signal)).rejects.toThrow(/^GOAL_AGGREGATE_ABORTED$/);
  });
  it('fails closed with no durable authority dependency', async () => {
    const f = await fixture(); Reflect.deleteProperty(f.ports, 'authority');
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it.each(['failed', 'cancelled', 'interrupted'] as const)('verifies retained exact %s journal without calling it completed', async status => {
    const f = await fixture(status); await expect(f.service().verifyDurableInventory(f.state())).resolves.toBeUndefined();
    f.db.exec("UPDATE chat_runs SET revision=5");
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it.each(['admission', 'sequence', 'phase', 'anchor', 'ack', 'policy', 'scope', 'unknown'])('rejects freshly content-addressed but inconsistent %s', async kind => {
    const f = await fixture(), raw = structuredClone(f.aggregate), attempt = raw.attempts[0]!;
    if (kind === 'admission') Reflect.set(attempt, 'admissions', []);
    if (kind === 'sequence') Reflect.set(attempt.admissions[0]!, 'globalSequence', 2);
    if (kind === 'phase') Reflect.set(attempt, 'phases', attempt.phases.slice(1));
    if (kind === 'anchor') Reflect.set(attempt, 'previousCheckpointId', 'foreign');
    if (kind === 'ack') f.db.exec("DELETE FROM audit_log WHERE id='ack-2'");
    if (kind === 'policy') Reflect.set(raw, 'completionPolicy', {});
    if (kind === 'scope') Reflect.set(attempt.scope, 'parentSessionId', 'human-host');
    if (kind === 'unknown') Reflect.set(raw, 'trusted', true);
    await f.republish(raw);
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it('rejects leaf mutation occurring after its initial read', async () => {
    const f = await fixture(); f.ports.authority.readDispatchExact = async () => {
      f.db.exec("UPDATE audit_log SET data='{}' WHERE id='phase-1'"); return structuredClone(f.facts);
    };
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it('does not treat external MCP execution as native evidence authority', async () => {
    const f = await fixture(); f.ports.authority.readDispatchExact = async () => ({ ...structuredClone(f.facts), target: 'external_mcp' });
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it('rejects raw driver secrets with a static error', async () => {
    const f = await fixture(); f.ports.authority.readDispatchExact = async () => { throw new Error('PRIVATE_DRIVER'); };
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it('requires native host BUILD, exact expectation and SQL HITL origin readback', async () => {
    const f = await fixture(); await f.enableBuild();
    await expect(f.service().verifyDurableInventory(f.state())).resolves.toBeUndefined();
  });
  it('rejects successful spawn plus passed BUILD projection without an independent output link', async () => {
    const f = await fixture(); await f.enableBuild(false);
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it.each(['scope-run', 'scope-root', 'scope-version', 'scope-source', 'scope-goal', 'scope-revision', 'spawn', 'output', 'terminal', 'owner',
    'source', 'executable', 'argv', 'cwd', 'shell-missing', 'shell-mismatch', 'status', 'exit', 'extra'])('rejects exact output link mismatch %s', async mode => {
    const f = await fixture(); await f.enableBuild();
    const link = JSON.parse((f.db.prepare('SELECT data FROM fixture_output_link').get() as { data: string }).data) as GoalTerminalOutputLink;
    const scopeFields: Record<string, string> = { 'scope-run': 'runId', 'scope-root': 'rootSessionId', 'scope-version': 'goalVersion',
      'scope-source': 'sourceFingerprint', 'scope-goal': 'goalFingerprint', 'scope-revision': 'inventoryStateRevision' };
    if (scopeFields[mode]) Reflect.set(link.scope, scopeFields[mode]!, 'foreign');
    if (mode === 'spawn') Reflect.set(link.spawn, 'callId', 'foreign');
    if (mode === 'output') Reflect.set(link.output.identity, 'runId', 'foreign');
    if (mode === 'terminal') Reflect.set(link, 'terminalId', 'foreign');
    if (mode === 'owner') Reflect.set(link.owner, 'turnId', 'foreign');
    if (mode === 'source') Reflect.set(link.approvedCommand.approvedSource, 'sessionId', 'root');
    if (mode === 'executable') Reflect.set(link.approvedCommand, 'executable', 'other');
    if (mode === 'argv') Reflect.set(link.approvedCommand, 'argv', ['help']);
    if (mode === 'cwd') Reflect.set(link.approvedCommand, 'canonicalCwd', 'E:\\foreign');
    if (mode === 'shell-missing') Reflect.deleteProperty(link.approvedCommand, 'shell');
    if (mode === 'shell-mismatch') Reflect.set(link.approvedCommand, 'shell', true);
    if (mode === 'status') Reflect.set(link, 'status', 'running');
    if (mode === 'exit') Reflect.set(link, 'exitCode', 1);
    if (mode === 'extra') Reflect.set(link, 'trusted', true);
    f.db.prepare('UPDATE fixture_output_link SET data=?').run(JSON.stringify(link));
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it.each(['scope', 'id', 'index', 'checkpoint', 'event', 'sequence', 'dispatch', 'message', 'evidence', 'extra'])('rejects persisted projection mismatch %s', async mode => {
    const f = await fixture();
    const projection = JSON.parse((f.db.prepare('SELECT data FROM fixture_projections').get() as { data: string }).data) as GoalEvidenceProjection;
    if (mode === 'scope') Reflect.set(projection.scope, 'inventoryStateRevision', 999);
    if (mode === 'id') Reflect.set(projection, 'evidenceId', 'foreign');
    if (mode === 'index') Reflect.set(projection.ref, 'evidenceIndex', 1);
    if (mode === 'checkpoint') Reflect.set(projection.ref, 'checkpointId', 'phase-0');
    if (mode === 'event') Reflect.set(projection.ref, 'eventId', 'foreign');
    if (mode === 'sequence') Reflect.set(projection.ref, 'sequence', 99);
    if (mode === 'dispatch') Reflect.set(projection.dispatch.identity, 'runId', 'foreign');
    if (mode === 'message') Reflect.set(projection, 'resultMessageId', 'foreign');
    if (mode === 'evidence') Reflect.set(projection.evidence, 'status', 'failed');
    if (mode === 'extra') Reflect.set(projection, 'trusted', true);
    f.db.prepare('UPDATE fixture_projections SET data=?').run(JSON.stringify(projection));
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it.each(['readEvidenceProjectionExact', 'readTerminalOutputLinkExact'] as const)('requires mandatory %s even for non-BUILD inventory', async key => {
    const f = await fixture(); Reflect.deleteProperty(f.ports.authority, key);
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it.each(['projection', 'link'])('rejects %s mutation on final reread', async kind => {
    const f = await fixture(); await f.enableBuild(); let calls = 0;
    if (kind === 'projection') {
      const read = f.ports.authority.readEvidenceProjectionExact;
      f.ports.authority.readEvidenceProjectionExact = async (...args) => { if (++calls === 2) f.db.exec('DELETE FROM fixture_projections'); return read(...args); };
    } else {
      const read = f.ports.authority.readTerminalOutputLinkExact;
      f.ports.authority.readTerminalOutputLinkExact = async (...args) => { if (++calls === 2) f.db.exec('DELETE FROM fixture_output_link'); return read(...args); };
    }
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/); expect(calls).toBe(2);
  });
  it.each(['projection', 'link'])('checks current canonical state after %s await', async kind => {
    const f = await fixture(); await f.enableBuild();
    if (kind === 'projection') { const read = f.ports.authority.readEvidenceProjectionExact;
      f.ports.authority.readEvidenceProjectionExact = async (...args) => { const row = await read(...args); f.mutateState(); return row; }; }
    else { const read = f.ports.authority.readTerminalOutputLinkExact;
      f.ports.authority.readTerminalOutputLinkExact = async (...args) => { const row = await read(...args); f.mutateState(); return row; }; }
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it.each(['projection', 'link'])('does not let %s reader mutate the expected scope snapshot', async kind => {
    const f = await fixture(); await f.enableBuild();
    if (kind === 'projection') { const read = f.ports.authority.readEvidenceProjectionExact;
      f.ports.authority.readEvidenceProjectionExact = async (...args) => { Reflect.set(args[0], 'sourceFingerprint', 'foreign');
        const row = (await read(...args))!; return { ...row, scope: structuredClone(args[0]) }; }; }
    else { const read = f.ports.authority.readTerminalOutputLinkExact;
      f.ports.authority.readTerminalOutputLinkExact = async (...args) => { Reflect.set(args[0], 'sourceFingerprint', 'foreign');
        const row = (await read(...args))!; return { ...row, scope: structuredClone(args[0]) }; }; }
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it.each(['receipt', 'result', 'journal', 'not-in-aggregate'])('requires independent output %s', async mode => {
    const f = await fixture(); await f.enableBuild();
    if (mode === 'receipt') { const read = f.ports.authority.readDispatchExact;
      f.ports.authority.readDispatchExact = async (...args) => args[1] === 'output-call' ? null : read(...args); }
    if (mode === 'result') f.db.exec("DELETE FROM messages WHERE id='output-result'");
    if (mode === 'journal') f.db.exec("UPDATE chat_runs SET status='failed',phase='failed' WHERE id='output-journal'");
    if (mode === 'not-in-aggregate') { Reflect.set(f.aggregate, 'attempts', [f.aggregate.attempts[0]!]); await f.republish(); }
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it('rejects completed output journal disappearing after link verification', async () => {
    const f = await fixture(); await f.enableBuild(); const read = f.ports.authority.readTerminalOutputLinkExact;
    f.ports.authority.readTerminalOutputLinkExact = async (...args) => { const row = await read(...args);
      f.db.exec("DELETE FROM chat_runs WHERE id='output-journal'"); return row; };
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it.each(['running', 'killed', 'exit1', 'owner', 'terminal', 'argv', 'shell'])('rejects actual persisted output %s despite exited0 link and passed inventory', async mode => {
    const f = await fixture(); await f.enableBuild();
    const stored = JSON.parse((f.db.prepare("SELECT content FROM messages WHERE id='output-result'").get() as { content: string }).content) as Record<string, unknown>;
    if (mode === 'running' || mode === 'killed') stored.status = mode;
    if (mode === 'exit1') stored.exitCode = 1;
    const descriptor = stored.executionDescriptor as Record<string, unknown>;
    if (mode === 'owner') Reflect.set(descriptor.ownerIdentity as object, 'callId', 'foreign');
    if (mode === 'terminal') descriptor.terminalId = 'foreign';
    if (mode === 'argv') descriptor.argv = ['help'];
    if (mode === 'shell') descriptor.shell = true;
    f.db.prepare("UPDATE messages SET content=? WHERE id='output-result'").run(JSON.stringify(stored));
    const result = (await f.ports.durableReader.readToolResultExact({ messageId: 'output-result', sessionId: 'branch', turnId: 'output-turn',
      promptMessageId: 'output-prompt', toolCallId: 'output-call', role: 'tool_result' }))!;
    const { content: _content, ...metadata } = result;
    const data = JSON.parse((f.db.prepare("SELECT data FROM audit_log WHERE id='output-phase-1'").get() as { data: string }).data) as Record<string, unknown>;
    data.result = metadata;
    f.db.prepare("UPDATE audit_log SET data=? WHERE id='output-phase-1'").run(JSON.stringify(data));
    const pointer = f.aggregate.attempts[1]!.phases.find(step => step.phase.id === 'output-phase-1')!.phase;
    const row = await f.audit.readGoalProofExact({ id: pointer.id, runId: 'run', rootSessionId: 'root', label: pointer.label });
    Reflect.set(pointer, 'expectedDataSha256', row.dataSha256);
    const read = f.ports.authority.readDispatchExact;
    f.ports.authority.readDispatchExact = async (...args) => {
      const receipt = await read(...args); return args[1] === 'output-call' && receipt ? { ...receipt, contentSha256: result.contentSha256 } : receipt;
    };
    await f.republish();
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it.each(['projection', 'link'])('does not invoke %s result getters or disclose driver/abort reasons', async kind => {
    const f = await fixture(); await f.enableBuild(); let reads = 0;
    if (kind === 'projection') { const read = f.ports.authority.readEvidenceProjectionExact;
      f.ports.authority.readEvidenceProjectionExact = async (...args) => { const row = (await read(...args))!;
        Object.defineProperty(row, 'scope', { enumerable: true, get() { reads++; throw new Error('PRIVATE_SECRET'); } }); return row; }; }
    else { const read = f.ports.authority.readTerminalOutputLinkExact;
      f.ports.authority.readTerminalOutputLinkExact = async (...args) => { const row = (await read(...args))!;
        Object.defineProperty(row, 'scope', { enumerable: true, get() { reads++; throw new Error('PRIVATE_SECRET'); } }); return row; }; }
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/); expect(reads).toBe(0);
    const controller = new AbortController();
    if (kind === 'projection') f.ports.authority.readEvidenceProjectionExact = async () => { controller.abort('PRIVATE_SECRET'); throw new Error('PRIVATE_DRIVER'); };
    else f.ports.authority.readTerminalOutputLinkExact = async () => { controller.abort('PRIVATE_SECRET'); throw new Error('PRIVATE_DRIVER'); };
    await expect(f.service().verifyDurableInventory(f.state(), controller.signal)).rejects.toThrow(/^GOAL_AGGREGATE_ABORTED$/);
  });
  it.each(['missing-hitl', 'revision', 'origin', 'requirement', 'session', 'call', 'auto', 'mcp', 'worker', 'selected', 'command', 'cwd'])(
    'rejects invalid host BUILD %s', async mode => {
      const f = await fixture(); const row = await f.enableBuild();
      if (mode === 'missing-hitl') f.db.exec('DELETE FROM fixture_hitl');
      if (mode === 'revision') Reflect.set(row, 'revision', 5);
      if (mode === 'origin') Reflect.deleteProperty(row.continuation, 'approvalOrigin');
      if (mode === 'requirement') Reflect.deleteProperty(row.continuation, 'hostConfirmationRequirement');
      if (mode === 'session') Reflect.set(row, 'sessionId', 'foreign');
      if (mode === 'call') Reflect.set(row, 'toolCallId', 'foreign');
      if (mode === 'auto') Reflect.set(f.facts, 'approval', { kind: 'non_durable', reason: 'subagent_auto' });
      if (mode === 'mcp') Reflect.set(f.facts, 'target', 'external_mcp');
      if (mode === 'worker') { Reflect.set(f.aggregate.attempts[0]!, 'role', 'worker'); await f.republish(); }
      if (mode === 'selected') { Reflect.set(f.aggregate, 'selectedBuildCallId', 'foreign'); await f.republish(); }
      if (mode === 'command') {
        const link = JSON.parse((f.db.prepare('SELECT data FROM fixture_output_link').get() as { data: string }).data) as GoalTerminalOutputLink;
        Reflect.set(link.approvedCommand, 'argv', ['help']); f.db.prepare('UPDATE fixture_output_link SET data=?').run(JSON.stringify(link));
      }
      if (mode === 'cwd') Reflect.set(f.aggregate.attempts[0]!.scope, 'canonicalCwd', 'E:\\foreign');
      if (['revision', 'origin', 'requirement', 'session', 'call'].includes(mode))
        f.db.prepare('UPDATE fixture_hitl SET data=?').run(JSON.stringify(row));
      await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
    });
  it('rejects child lifecycle mismatches rather than boolean confirmation', async () => {
    const f = await fixture();
    const ref = { childId: 'child', sessionId: 'branch', lifecycleCheckpointId: 'child-leaf', launchToolCallId: 'call',
      terminalToolCallId: 'call', terminalMessageId: 'terminal' };
    Reflect.set(f.inventory.provenance.childRefsById, 'child', ref); Reflect.set(f.inventory.host.cliChildrenById, 'child', 'passed');
    f.ports.authority.readChildExact = async () => ({ ref, status: 'failed' });
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it('does not invoke input getters', async () => {
    const f = await fixture(); let reads = 0; const state = f.state();
    Object.defineProperty(state, 'runId', { enumerable: true, get() { reads++; return 'run'; } });
    await expect(f.service().verifyDurableInventory(state)).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/); expect(reads).toBe(0);
  });
  it('requires the aggregate to preserve exact supersession', async () => {
    const f = await fixture(); Reflect.set(f.aggregate, 'supersededEvidenceIds', { missing: 'read' }); await f.republish();
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it.each([false, true])('retains cancelled nonexecution without evidence (pre-entry diagnostic=%s)', async retained => {
    const f = await fixture();
    f.db.exec(`UPDATE messages SET content='{"status":"cancelled"}' WHERE id='result'`);
    const result = (await f.ports.durableReader.readToolResultExact({ messageId: 'result', sessionId: 'branch', turnId: 'tool-turn',
      promptMessageId: 'tool-prompt', toolCallId: 'call', role: 'tool_result' }))!;
    const { content: _content, ...metadata } = result;
    const stored = f.db.prepare("SELECT data FROM audit_log WHERE id='phase-1'").get() as { data: string };
    const value = JSON.parse(stored.data) as Record<string, unknown>;
    value.status = 'cancelled'; value.resolved = null; value.result = metadata;
    f.db.prepare("UPDATE audit_log SET data=? WHERE id='phase-1'").run(JSON.stringify(value));
    Reflect.set(f.inventory.provenance.checkpoint.commits[0]!, 'status', 'cancelled');
    Reflect.set(f.inventory.host, 'evidenceById', {}); Reflect.set(f.inventory.provenance, 'evidenceRefsById', {});
    for (const [key, value] of Object.entries({ canonicalName: null, target: null, approval: null, resultStatus: 'cancelled',
      contentSha256: result.contentSha256 })) Reflect.set(f.facts, key, value);
    if (retained) {
      await f.refreshLeaves();
      await expect(f.service().verifyDurableInventory(f.state())).resolves.toBeUndefined();
      // The same null-entry transition cannot claim tool success or error.
      for (const status of ['success', 'error']) {
        value.status = status; Reflect.set(f.facts, 'resultStatus', status);
        Reflect.set(f.inventory.provenance.checkpoint.commits[0]!, 'status', status);
        f.db.prepare("UPDATE audit_log SET data=? WHERE id='phase-1'").run(JSON.stringify(value));
        await f.refreshLeaves();
        await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
      }
      return;
    }
    const attempt = f.aggregate.attempts[0]!;
    Reflect.set(attempt, 'phases', attempt.phases.filter(step => step.phase.id !== 'phase-resolved'));
    for (const [i, step] of attempt.phases.entries()) if (i >= 2) for (const [kind, pointer] of Object.entries(step)) {
      const raw = JSON.parse((f.db.prepare('SELECT data FROM audit_log WHERE id=?').get(pointer.id) as { data: string }).data) as Record<string, unknown>;
      if (kind === 'ack') raw.stateRevision = Number(raw.stateRevision) - 1;
      else raw.expectedStateRevision = Number(raw.expectedStateRevision) - 1;
      if (kind === 'phase') raw.phaseSequence = Number(raw.phaseSequence) - 1;
      if (i === 2 && kind !== 'ack') raw.previousCheckpointId = 'anchor-0';
      f.db.prepare('UPDATE audit_log SET data=? WHERE id=?').run(JSON.stringify(raw), pointer.id);
    }
    Reflect.set(f.aggregate, 'inventoryStateRevision', 7); Reflect.set(f.inventory, 'inventoryStateRevision', 7); f.setRevision(7);
    await f.refreshLeaves();
    await expect(f.service().verifyDurableInventory(f.state())).resolves.toBeUndefined();
  });
  it('accepts actual producer resolved phase between admission and commit', async () => {
    const f = await fixture();
    await expect(f.service().verifyDurableInventory(f.state())).resolves.toBeUndefined();
  });
  it('preserves failed attempt leaves and original/global sequences across a retry', async () => {
    const f = await fixture('failed'), first = f.aggregate.attempts[0]!;
    const identity = { runId: 'retry-journal', sessionId: 'branch', turnId: 'retry-turn', promptMessageId: 'retry-prompt' };
    f.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('retry-prompt', 'branch', 'user', 'Retry', 'retry-turn', 'retry-prompt', null, 10);
    f.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('retry-result', 'branch', 'tool_result', '{"text":"hello"}', 'retry-turn', 'retry-prompt', 'retry-call', 11);
    f.db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('retry-terminal', 'branch', 'assistant', 'Done', 'retry-turn', 'retry-prompt', null, 12);
    f.db.prepare('INSERT INTO chat_runs VALUES (?,?,?,?,?,?,?,?,?)').run('retry-journal', 'branch', 'retry-turn', 'completed', 'completed', 4,
      '{"messageId":"retry-terminal"}', 12, 12);
    const journal = (await f.ports.durableReader.readCompletedRunExact({ chatRunId: 'retry-journal', sessionId: 'branch', turnId: 'retry-turn',
      promptMessageId: 'retry-prompt', terminalMessageId: 'retry-terminal', revision: 4 }))!;
    const result = (await f.ports.durableReader.readToolResultExact({ messageId: 'retry-result', sessionId: 'branch', turnId: 'retry-turn',
      promptMessageId: 'retry-prompt', toolCallId: 'retry-call', role: 'tool_result' }))!;
    const facts: GoalDurableDispatchFacts = { ...structuredClone(f.facts), identity, callId: 'retry-call', resultMessageId: 'retry-result',
      contentSha256: result.contentSha256 };
    const retryEvidence: WorkflowEvidence = { kind: 'VFS_READ', status: 'passed', source: 'retry-result' };
    const { content: _content, ...resultMetadata } = result;
    const phases = [];
    let previous = 'anchor-3';
    for (const [i, step] of first.phases.entries()) {
      const refs = [];
      for (const [kind, pointer] of Object.entries(step)) {
        const data = JSON.parse((f.db.prepare('SELECT data FROM audit_log WHERE id=?').get(pointer.id) as { data: string }).data) as Record<string, unknown>;
        data.attemptId = 'retry';
        if (Object.hasOwn(data, 'identity')) data.identity = identity;
        if (kind === 'phase') {
          data.expectedStateRevision = i + 7; data.previousCheckpointId = previous;
          if (Object.hasOwn(data, 'callId')) data.callId = 'retry-call';
          if (data.phase === 'journal_terminal_verified') { data.phase = 'journal_verified'; data.journal = journal; }
          if (objectForTest(data.resolved)) data.resolved = { ...data.resolved, identity, callId: 'retry-call' };
          if (data.phase === 'committed') data.result = resultMetadata;
        } else if (kind === 'anchor') {
          data.expectedStateRevision = i + 7; data.previousCheckpointId = previous; data.phaseEventId = `retry-${step.phase.id}`;
        } else {
          data.stateRevision = i + 8; data.phaseEventId = `retry-${step.phase.id}`; data.inventoryCheckpointId = `retry-${step.anchor.id}`;
        }
        const id = `retry-${pointer.id}`, label = kind === 'phase' ? `goal_receipt:${data.phase}` : pointer.label;
        await f.audit.logRequired(id, { sessionId: 'root', type: 'architecture_event', label, data });
        const row = await f.audit.readGoalProofExact({ id, runId: 'run', rootSessionId: 'root', label });
        refs.push({ id, runId: 'run', rootSessionId: 'root', label, expectedDataSha256: row.dataSha256 });
      }
      phases.push({ phase: refs[0]!, anchor: refs[1]!, ack: refs[2]! }); previous = `retry-${step.anchor.id}`;
    }
    Reflect.set(f.aggregate, 'attempts', [first, { ...first, attemptId: 'retry', identity, previousCheckpointId: 'anchor-3', phases,
      terminal: { kind: 'completed', record: journal }, admissions: [{ callId: 'retry-call', originalSequence: 1, globalSequence: 2 }] }]);
    Reflect.set(f.aggregate, 'inventoryStateRevision', 14); Reflect.set(f.inventory, 'inventoryStateRevision', 14);
    Reflect.set(f.aggregate, 'supersededEvidenceIds', { read: 'retry' }); Reflect.set(f.inventory.provenance, 'supersededEvidenceIds', { read: 'retry' });
    Reflect.set(f.inventory.host, 'evidenceById', { retry: retryEvidence });
    Reflect.set(f.inventory.provenance.evidenceRefsById, 'retry', { checkpointId: 'retry-phase-1', eventId: 'retry-phase-1', sequence: 2,
      evidenceIndex: 0, dispatchCallId: 'retry-call' });
    Reflect.set(f.inventory.provenance.checkpoint, 'admissions', [...f.inventory.provenance.checkpoint.admissions,
      { callId: 'retry-call', sessionId: 'branch', turnId: 'retry-turn', promptMessageId: 'retry-prompt', sequence: 2, admissionCheckpointId: 'retry-phase-0' }]);
    Reflect.set(f.inventory.provenance.checkpoint, 'commits', [...f.inventory.provenance.checkpoint.commits,
      { callId: 'retry-call', sequence: 2, commitCheckpointId: 'retry-phase-1', resultMessageId: 'retry-result', status: 'success' }]);
    f.ports.authority.readDispatchExact = async (actualIdentity, callId) =>
      callId === 'retry-call' && actualIdentity.runId === 'retry-journal' ? structuredClone(facts)
        : callId === 'call' && actualIdentity.runId === 'chat-journal' ? structuredClone(f.facts) : null;
    f.saveProjection({ scope: f.proofScope(), evidenceId: 'retry', ref: structuredClone(f.inventory.provenance.evidenceRefsById.retry!),
      dispatch: { identity, callId: 'retry-call' }, resultMessageId: 'retry-result', evidence: retryEvidence });
    f.setRevision(14); await f.republish();
    await expect(f.service().verifyDurableInventory(f.state())).resolves.toBeUndefined();
    const historical = (f.db.prepare("SELECT data FROM fixture_projections WHERE id='read'").get() as { data: string }).data;
    f.db.exec("DELETE FROM fixture_projections WHERE id='read'");
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
    f.db.prepare('INSERT INTO fixture_projections VALUES (?,?)').run('read', historical);
    const forged = JSON.parse(historical) as GoalEvidenceProjection;
    Reflect.set(forged.evidence, 'kind', 'INVENTED_PROOF');
    f.db.prepare("UPDATE fixture_projections SET data=? WHERE id='read'").run(JSON.stringify(forged));
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
    f.db.prepare("UPDATE fixture_projections SET data=? WHERE id='read'").run(historical);
    f.db.exec("DELETE FROM audit_log WHERE id='phase-1'");
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it.each(['source', 'result', 'hitl'])('rejects late %s drift after its first exact read', async kind => {
    const f = await fixture();
    if (kind === 'hitl') await f.enableBuild();
    const read = f.ports.persistedScope.readRegisteredScope;
    let calls = 0;
    f.ports.persistedScope.readRegisteredScope = async key => {
      calls++;
      if (calls === 2) {
        if (kind === 'source') f.ports.sourceReader.read = async () => null;
        if (kind === 'result') f.db.exec("UPDATE messages SET content='changed' WHERE id='result'");
        if (kind === 'hitl') f.db.exec('DELETE FROM fixture_hitl');
      }
      return read(key);
    };
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
  it('rejects an internally consistent BUILD expectation outside persisted execution cwd', async () => {
    const f = await fixture(); await f.enableBuild();
    Reflect.set(f.aggregate.buildExpectation!, 'canonicalCwd', 'E:\\foreign'); await f.republish();
    await expect(f.service().verifyDurableInventory(f.state())).rejects.toThrow(/^GOAL_AGGREGATE_INVALID$/);
  });
});
function objectForTest(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
