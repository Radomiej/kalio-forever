import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  HostResolvedToolDispatch,
  HostRuntimeReceiptIdentity,
  HostRuntimeReceiptObserver,
  HostRuntimeToolAdmission,
  HostRuntimeToolCommit,
  ToolCallRequest,
} from '@kalio/types';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { MCPService } from '../mcp/mcp.service';
import { DrizzleMessageRepository } from './drizzle-message.repository';
import { HostDispatchReceiptService } from './host-dispatch-receipt.service';
import type { ToolRegistryEntry } from './interfaces/tool-registry-entry.interface';
import { PersistedRuntimeEvidenceReader } from './persisted-runtime-evidence-reader';
import { RunJournalService } from './run-journal.service';
import { SessionManagerService } from './session-manager.service';
import { ToolConfirmationService } from './tool-confirmation.service';
import { ToolDispatchService } from './tool-dispatch.service';
import {
  ChatOwnedHostBuildExecutionAdapter,
  type BoundHostBuildScope,
  type FreshHostBuildOutputClaim,
  type GoalHostBuildScopeGuardPort,
  type HostApprovedBuildCommand,
  type HostBuildExecutionBinding,
  type HostBuildLeafEvidence,
  type HostBuildOutputReadback,
  type HostBuildRouteOwner,
  type HostBuildSpawnInput,
  type HostBuildSpawnReadback,
  type HostBuildReceiptObserverFactoryInput,
  type PersistedHostBuildLeaf,
  type TrustedHostBuildRoutePort,
} from './chat-owned-host-build-execution.adapter';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.close()));

const command: HostApprovedBuildCommand = {
  executable: 'npm.cmd',
  argv: ['run', 'build'],
  canonicalCwd: 'E:\\Projekty\\home-site',
  shell: process.platform === 'win32',
  approvedSourceLocator: 'project:home-site',
  commandFingerprint: 'command-fingerprint',
  policyFingerprint: 'policy-fingerprint',
};
const binding: HostBuildExecutionBinding = {
  runId: 'architecture-run', nodeId: 'build-node', attemptId: 'attempt-1',
  goalVersion: 2, goalFingerprint: 'goal-fingerprint', expectedGoalRevision: 7,
  sessionId: 'session-1',
};

function createTables(client: Database.Database): void {
  client.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      turn_id TEXT, prompt_message_id TEXT, thinking TEXT, tool_calls TEXT, tool_call_id TEXT,
      attachments TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE chat_runs (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT NOT NULL, phase TEXT NOT NULL,
      status TEXT NOT NULL, provider TEXT, model TEXT, runtime_kind TEXT, execution_profile_id TEXT,
      external_thread_id TEXT, external_turn_id TEXT, process_epoch TEXT, revision INTEGER NOT NULL DEFAULT 1,
      retry_count INTEGER NOT NULL DEFAULT 0, safe_resume INTEGER NOT NULL DEFAULT 0,
      error_code TEXT, error_message TEXT, queue_idempotency_key TEXT, queued_payload TEXT,
      queued_at INTEGER, queue_claimed_at INTEGER, queue_cancelled_at INTEGER, outcome TEXT,
      started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_heartbeat_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE UNIQUE INDEX chat_runs_session_queue_key ON chat_runs(session_id, queue_idempotency_key);
    CREATE TABLE hitl_requests (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      session_id TEXT NOT NULL, turn_id TEXT, run_id TEXT, tool_call_id TEXT, payload TEXT NOT NULL,
      continuation TEXT, outcome TEXT, revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, resolved_at INTEGER
    );
    CREATE TABLE host_dispatch_receipts (
      run_id TEXT NOT NULL, session_id TEXT NOT NULL, turn_id TEXT NOT NULL,
      prompt_message_id TEXT NOT NULL, call_id TEXT NOT NULL,
      record_json TEXT NOT NULL, record_sha256 TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, session_id, turn_id, prompt_message_id, call_id)
    );
    INSERT INTO sessions(id) VALUES ('session-1');
  `);
}

interface ObserverCapture {
  observer: HostRuntimeReceiptObserver;
  admissions: HostRuntimeToolAdmission[];
  dispatches: HostResolvedToolDispatch[];
  commits: HostRuntimeToolCommit[];
  drainCalls: HostRuntimeReceiptIdentity[];
  journalCompleteCalls: HostRuntimeReceiptIdentity[];
}

function captureObserver(onAdmission?: (receipt: HostRuntimeToolAdmission) => void, initiallyClosed = false): ObserverCapture {
  const admissions: HostRuntimeToolAdmission[] = [];
  const dispatches: HostResolvedToolDispatch[] = [];
  const commits: HostRuntimeToolCommit[] = [];
  const drainCalls: HostRuntimeReceiptIdentity[] = [];
  const journalCompleteCalls: HostRuntimeReceiptIdentity[] = [];
  let drained = initiallyClosed;
  return {
    admissions, dispatches, commits, drainCalls, journalCompleteCalls,
    observer: {
      admit: async (receipt) => { if (drained) throw new Error('OBSERVER_CLOSED'); admissions.push(receipt); onAdmission?.(receipt); },
      resolvedDispatch: async (receipt) => { dispatches.push(receipt); },
      commit: async (receipt) => { commits.push(receipt); },
      drain: async (identity) => { drainCalls.push(identity); drained = true; },
      journalComplete: async (identity, completed) => {
        journalCompleteCalls.push(identity);
        expect(drained).toBe(true);
        expect(completed).toMatchObject({ phase: 'completed', status: 'completed' });
      },
    },
  };
}

class ExactTestRouteAuthority implements TrustedHostBuildRoutePort {
  forceUnresolved = false;
  forgeOwner = false;
  abortOnClaim: AbortController | null = null;
  readonly signals: AbortSignal[] = [];
  readonly claims = new Map<string, {
    owner: HostBuildRouteOwner;
    operation: 'spawn' | 'output';
    persisted?: HostBuildLeafEvidence;
    spawnReadback?: HostBuildSpawnReadback;
    outputReadback?: HostBuildOutputReadback;
  }>();

  constructor(
    private readonly reader: PersistedRuntimeEvidenceReader,
    private readonly captures: Map<string, ObserverCapture>,
  ) {}

  async claimSpawn(input: Parameters<TrustedHostBuildRoutePort['claimSpawn']>[0]) {
    this.signals.push(input.signal);
    if (this.abortOnClaim) {
      this.abortOnClaim.abort(new Error('private abort reason'));
      throw this.abortOnClaim.signal.reason;
    }
    if (this.forceUnresolved) return { kind: 'unresolved' as const, reason: 'in_flight' as const };
    const existing = this.claims.get(input.callId);
    if (existing?.spawnReadback) return { kind: 'replay' as const, claimRef: input.callId, persistedLeafRef: input.callId };
    if (existing) return { kind: 'unresolved' as const, reason: 'recovery_required' as const };
    this.claims.set(input.callId, { owner: input.owner, operation: 'spawn' });
    return { kind: 'fresh' as const, claimRef: input.callId };
  }

  async readbackSpawn(input: Parameters<TrustedHostBuildRoutePort['readbackSpawn']>[0]): Promise<HostBuildSpawnReadback> {
    this.signals.push(input.signal);
    const row = this.claims.get(input.claim.claimRef)!;
    if (input.claim.kind === 'replay') return this.rebuild(row.spawnReadback!);
    if (!('persistedLeaf' in input)) throw new Error('missing persisted leaf');
    const evidence = await this.evidence(input.persistedLeaf);
    const parsed = JSON.parse(evidence.toolResult.content) as { id?: unknown };
    const readback: HostBuildSpawnReadback = parsed.id
      ? { kind: 'spawned', owner: this.owner(row.owner), terminalOwner: this.terminalOwner(input.persistedLeaf),
          terminalRouteRef: `route:${String(parsed.id)}`, leaf: input.persistedLeaf, evidence }
      : { kind: 'not_spawned', owner: this.owner(row.owner), leaf: input.persistedLeaf, evidence };
    row.persisted = evidence; row.spawnReadback = readback;
    return readback;
  }

  async claimOutput(input: Parameters<TrustedHostBuildRoutePort['claimOutput']>[0]) {
    this.signals.push(input.signal);
    if (this.forceUnresolved) return { kind: 'unresolved' as const, reason: 'missing_durable_state' as const };
    const existing = this.claims.get(input.callId);
    if (existing?.outputReadback) return { kind: 'replay' as const, claimRef: input.callId, persistedLeafRef: input.callId };
    if (existing) return { kind: 'unresolved' as const, reason: 'recovery_required' as const };
    const spawn = [...this.claims.values()].find((claim) => claim.spawnReadback?.kind === 'spawned')?.spawnReadback;
    if (!spawn || spawn.kind !== 'spawned') return { kind: 'unresolved' as const, reason: 'missing_durable_state' as const };
    this.claims.set(input.callId, { owner: input.owner, operation: 'output' });
    return { kind: 'fresh' as const, claimRef: input.callId,
      terminalId: spawn.terminalRouteRef.slice('route:'.length), terminalOwner: spawn.terminalOwner } satisfies FreshHostBuildOutputClaim;
  }

  async readbackOutput(input: Parameters<TrustedHostBuildRoutePort['readbackOutput']>[0]): Promise<HostBuildOutputReadback> {
    this.signals.push(input.signal);
    const row = this.claims.get(input.claim.claimRef)!;
    if (input.claim.kind === 'replay') return this.rebuild(row.outputReadback!);
    if (!('persistedLeaf' in input)) throw new Error('missing persisted leaf');
    const evidence = await this.evidence(input.persistedLeaf);
    const parsed = JSON.parse(evidence.toolResult.content) as { id: string; status: string; exitCode: number | null };
    const base = { owner: this.owner(row.owner), terminalOwner: input.claim.terminalOwner,
      terminalRouteRef: `route:${parsed.id}`, leaf: input.persistedLeaf, evidence };
    const readback: HostBuildOutputReadback = parsed.status === 'running'
      ? { kind: 'running', ...base }
      : parsed.status === 'exited'
        ? { kind: 'exited', exitCode: parsed.exitCode, ...base }
        : parsed.status === 'killed'
          ? { kind: 'killed', ...base }
        : { kind: 'not_observed', ...base };
    row.persisted = evidence; row.outputReadback = readback;
    return readback;
  }

  private owner(owner: HostBuildRouteOwner): HostBuildRouteOwner {
    return this.forgeOwner ? { ...owner, attemptId: 'foreign-attempt' } : owner;
  }

  private terminalOwner(leaf: { sessionId: string; turnId: string; callId: string }) {
    return { sessionId: leaf.sessionId, turnId: leaf.turnId, callId: leaf.callId };
  }

  private async evidence(leaf: PersistedHostBuildLeaf): Promise<HostBuildLeafEvidence> {
    const toolResult = await this.reader.readToolResultExact({
      messageId: this.capture(leaf).persistedMessageId, sessionId: leaf.sessionId, turnId: leaf.turnId,
      promptMessageId: leaf.promptMessageId, toolCallId: leaf.callId, role: 'tool_result',
    });
    if (!toolResult) throw new Error('missing tool result');
    const journal = leaf.journalStatus === 'completed'
      ? await this.reader.readCompletedRunExact({ chatRunId: leaf.journalRunId, sessionId: leaf.sessionId,
          turnId: leaf.turnId, revision: leaf.journalRevision, promptMessageId: leaf.promptMessageId,
          terminalMessageId: leaf.assistantMessageId })
      : await this.reader.readTerminalRunExact({ chatRunId: leaf.journalRunId, sessionId: leaf.sessionId,
          turnId: leaf.turnId, promptMessageId: leaf.promptMessageId, revision: leaf.journalRevision,
          status: leaf.journalStatus, phase: leaf.journalPhase, outcomeMessageId: null });
    if (!journal) throw new Error('missing journal');
    return { leaf, toolResult, journal, commit: this.capture(leaf) };
  }

  private capture(leaf: PersistedHostBuildLeaf): HostRuntimeToolCommit {
    const commit = this.captures.get(leaf.callId)?.commits.find((candidate) => candidate.callId === leaf.callId);
    if (!commit) throw new Error('missing commit');
    return commit;
  }

  private rebuild<T extends HostBuildSpawnReadback | HostBuildOutputReadback>(readback: T): T {
    return { ...readback, owner: { ...readback.owner }, leaf: { ...readback.leaf },
      evidence: { ...readback.evidence, leaf: { ...readback.evidence.leaf } },
      ...('terminalOwner' in readback ? { terminalOwner: { ...readback.terminalOwner } } : {}) } as T;
  }
}

function fixture(options: {
  malformedDescriptor?: boolean;
  closedObserver?: boolean;
  invalidObserver?: boolean;
  abortDuringSpawn?: AbortController;
  abortAfterCommit?: AbortController;
  spawnError?: boolean;
  outputStatus?: 'running' | 'exited' | 'killed';
} = {}) {
  const client = new Database(':memory:'); clients.push(client); createTables(client);
  const drizzleService = new DrizzleService(null as never);
  (drizzleService as unknown as { db: unknown }).db = drizzle(client, { schema });
  const journals = new RunJournalService(drizzleService);
  const sessions = new SessionManagerService(new DrizzleMessageRepository(drizzleService), null as never, null as never, journals);
  const evidenceReader = new PersistedRuntimeEvidenceReader(drizzleService);
  const hitlRequests = new HitlRequestService(drizzleService);
  const confirmations = new ToolConfirmationService(null, null, null, hitlRequests);
  const executions = { spawn: 0, output: 0 };
  let descriptor: Record<string, unknown> | null = null;
  const tools: ToolRegistryEntry[] = [{
    meta: { name: 'terminal_spawn', description: '', parameters: {}, requiresConfirmation: true },
    catalogEntryId: 'chat.terminal_spawn',
    executorImplementationId: 'terminal.spawn.fixture',
    executorImplementationVersion: 1,
    execute: async (request: ToolCallRequest) => {
      executions.spawn++;
      if (options.spawnError) throw new Error('build process did not start');
      descriptor = { terminalId: 'terminal-1', executable: command.executable, argv: [...command.argv],
        actualCwd: command.canonicalCwd, shell: command.shell,
        ownerIdentity: { sessionId: request.sessionId, turnId: request.turnId, callId: request.callId },
        ...(options.malformedDescriptor ? { forged: true } : {}) };
      options.abortDuringSpawn?.abort(new Error('private tool abort reason'));
      return { id: 'terminal-1', pid: 42, command: `${command.executable} ${command.argv.join(' ')}`,
        executionDescriptor: descriptor };
    },
  }, {
    meta: { name: 'terminal_output', description: '', parameters: {}, requiresConfirmation: false },
    catalogEntryId: 'chat.terminal_output',
    executorImplementationId: 'terminal.output.fixture',
    executorImplementationVersion: 1,
    execute: async () => {
      executions.output++;
      const status = options.outputStatus ?? 'exited';
      return { id: 'terminal-1', status, exitCode: status === 'exited' ? 0 : null,
        output: status === 'exited' ? 'built' : '', executionDescriptor: descriptor };
    },
  }];
  const toolDispatch = new ToolDispatchService(tools, null, null, null, null, confirmations);
  const dispatchReceipts = new HostDispatchReceiptService(
    drizzleService, tools, evidenceReader, new MCPService(drizzleService),
  );
  const captures = new Map<string, ObserverCapture>();
  const route = new ExactTestRouteAuthority(evidenceReader, captures);
  const scopeSignals: AbortSignal[] = [];
  const scope: BoundHostBuildScope = { scopeBindingRef: 'scope-ref', command };
  const scopeGuard: GoalHostBuildScopeGuardPort = {
    bindExact: async (input) => { scopeSignals.push(input.signal); return scope; },
    verifyCurrent: async (input) => { scopeSignals.push(input.signal); return { scopeProofRef: 'scope-proof' }; },
  };
  const factoryCalls: HostBuildReceiptObserverFactoryInput[] = [];
  const openReceiptObserver = async (input: HostBuildReceiptObserverFactoryInput): Promise<HostRuntimeReceiptObserver> => {
    factoryCalls.push(input);
    if (options.invalidObserver) return { admit: async () => undefined } as unknown as HostRuntimeReceiptObserver;
    const capture = captureObserver((receipt) => captures.set(receipt.callId, capture), options.closedObserver);
    if (!options.abortAfterCommit) return capture.observer;
    return { ...capture.observer, commit: async (receipt) => {
      await capture.observer.commit(receipt);
      options.abortAfterCommit!.abort(new Error('private post-commit abort reason'));
    } };
  };
  const adapter = new ChatOwnedHostBuildExecutionAdapter({
    journals, sessions, toolDispatch, dispatchReceipts, scopeGuard, route, openReceiptObserver,
  });
  const emit = vi.fn();
  const approve = async (pending: Promise<unknown>) => {
    let requestId = '';
    await vi.waitFor(() => { const requests = toolDispatch.getPendingConfirmations(binding.sessionId);
      expect(requests).toHaveLength(1); requestId = requests[0]!.requestId; });
    expect(await toolDispatch.resolveConfirmation(requestId, binding.sessionId)).toBe('rejected');
    expect(await toolDispatch.resolveConfirmationFromGateway(requestId, binding.sessionId, 'socket-1')).toBe('resolved');
    await pending;
  };
  return { adapter, client, route, scope, scopeSignals, executions, emit, approve, captures, factoryCalls, dispatchReceipts };
}

describe('ChatOwnedHostBuildExecutionAdapter', () => {
  it('persists a real spawn leaf and requires exact gateway HITL before execution', async () => {
    const f = fixture(); const signal = new AbortController().signal;
    const pending = f.adapter.spawn({ binding, command, leafId: 'spawn-leaf', callId: 'spawn-call',
      emit: f.emit, signal });
    await f.approve(pending); const result = await pending;
    expect(result).toMatchObject({ kind: 'spawned', replayed: false, terminalRouteRef: 'route:terminal-1' });
    expect(f.executions.spawn).toBe(1);
    expect(f.client.prepare('SELECT role FROM messages ORDER BY created_at, rowid').all())
      .toEqual([{ role: 'user' }, { role: 'assistant' }, { role: 'tool_result' }]);
    expect(result.kind === 'spawned' && result.evidence.commit.hitlCommit).toMatchObject({
      status: 'approved', executionState: 'tool_result_committed', resultStatus: 'success',
    });
    expect(f.route.signals.every((seen) => seen === signal)).toBe(true);
    expect(f.scopeSignals.every((seen) => seen === signal)).toBe(true);
    expect(f.factoryCalls).toHaveLength(1);
    expect(f.factoryCalls[0]).toMatchObject({ binding, scope: f.scope, signal,
      identity: { runId: result.kind === 'spawned' ? result.leaf.journalRunId : '', sessionId: binding.sessionId,
        turnId: result.kind === 'spawned' ? result.leaf.turnId : '',
        promptMessageId: result.kind === 'spawned' ? result.leaf.promptMessageId : '' } });
    expect(result).not.toHaveProperty('passed');
  });

  it('replays immutable spawn evidence without a second dispatch or journal', async () => {
    const f = fixture(); const input = { binding, command, leafId: 'spawn-leaf', callId: 'spawn-call',
      emit: f.emit, signal: new AbortController().signal };
    const first = f.adapter.spawn(input); await f.approve(first); await first;
    const before = f.client.prepare('SELECT count(*) AS count FROM chat_runs').get();
    const replayed = await f.adapter.spawn(input);
    expect(replayed).toMatchObject({ kind: 'spawned', replayed: true });
    expect(f.executions.spawn).toBe(1);
    expect(f.client.prepare('SELECT count(*) AS count FROM chat_runs').get()).toEqual(before);
  });

  it('returns unresolved without creating chat state or dispatching', async () => {
    const f = fixture(); f.route.forceUnresolved = true;
    await expect(f.adapter.spawn({ binding, command, leafId: 'spawn-leaf', callId: 'spawn-call',
      emit: f.emit, signal: new AbortController().signal }))
      .resolves.toEqual({ kind: 'unresolved', reason: 'in_flight' });
    expect(f.executions.spawn).toBe(0);
    expect(f.client.prepare('SELECT count(*) AS count FROM chat_runs').get()).toEqual({ count: 0 });
    expect(f.client.prepare('SELECT count(*) AS count FROM messages').get()).toEqual({ count: 0 });
  });

  it.each(['owner', 'descriptor'] as const)('rejects non-exact %s evidence after real persistence', async (mode) => {
    const f = fixture({ malformedDescriptor: mode === 'descriptor' }); f.route.forgeOwner = mode === 'owner';
    const pending = f.adapter.spawn({ binding, command, leafId: 'spawn-leaf', callId: 'spawn-call',
      emit: f.emit, signal: new AbortController().signal });
    await expect((async () => { await f.approve(pending); return pending; })()).rejects.toThrow(
      mode === 'owner' ? 'HOST_BUILD_OWNER_MISMATCH' : 'HOST_BUILD_DESCRIPTOR_INVALID',
    );
    expect(f.client.prepare('SELECT status FROM chat_runs').get()).toEqual({ status: 'completed' });
  });

  it('polls through the real dispatcher and returns exit zero only as terminal evidence', async () => {
    const f = fixture(); const signal = new AbortController().signal;
    const spawn = f.adapter.spawn({ binding, command, leafId: 'spawn-leaf', callId: 'spawn-call',
      emit: f.emit, signal });
    await f.approve(spawn); const spawned = await spawn;
    if (spawned.kind !== 'spawned') throw new Error('expected spawn');
    const result = await f.adapter.poll({ binding, scope: spawned.scope, terminalRouteRef: spawned.terminalRouteRef,
      leafId: 'output-leaf', callId: 'output-call', waitMs: 30_000,
      emit: f.emit, signal });
    expect(result).toMatchObject({ kind: 'exited', exitCode: 0, replayed: false, scopeProofRef: 'scope-proof' });
    if (result.kind !== 'exited') throw new Error('expected exited output');
    expect(f.executions.output).toBe(1);
    expect(toolResultCount(f.client)).toBe(2);
    const rows = f.client.prepare(
      'SELECT call_id AS callId, record_json AS recordJson, record_sha256 AS recordSha256 FROM host_dispatch_receipts ORDER BY rowid',
    ).all() as Array<{ callId: string; recordJson: string; recordSha256: string }>;
    expect(rows.map((row) => row.callId)).toEqual(['spawn-call', 'output-call']);
    expect(rows.every((row) => row.recordJson.length > 0 && /^[a-f0-9]{64}$/.test(row.recordSha256))).toBe(true);
    for (const leaf of [spawned.leaf, result.leaf]) {
      const receipt = await f.dispatchReceipts.recorder.readExact({
        runId: leaf.journalRunId, sessionId: leaf.sessionId, turnId: leaf.turnId,
        promptMessageId: leaf.promptMessageId, callId: leaf.callId,
      }, signal);
      expect(receipt?.payload.enteredTarget).toMatchObject({
        kind: 'kalio_registry', catalogEntryId: `chat.${leaf.toolName}`,
        executorImplementationId: leaf.toolName === 'terminal_spawn'
          ? 'terminal.spawn.fixture' : 'terminal.output.fixture',
        executorImplementationVersion: 1,
      });
    }
    expect(result).not.toHaveProperty('passed');
  });

  it('does not commit the observer or respawn when durable receipt persistence fails', async () => {
    const f = fixture();
    f.client.exec(`CREATE TRIGGER reject_host_dispatch_receipt BEFORE INSERT ON host_dispatch_receipts
      BEGIN SELECT RAISE(ABORT, 'receipt persistence rejected'); END;`);
    const input = { binding, command, leafId: 'spawn-leaf', callId: 'spawn-call',
      emit: f.emit, signal: new AbortController().signal };
    const pending = f.adapter.spawn(input);
    await expect(f.approve(pending)).rejects.toThrow('HOST_DISPATCH_RECEIPT_STORAGE');
    expect(f.executions.spawn).toBe(1);
    expect(f.captures.get('spawn-call')?.commits).toHaveLength(0);
    expect(f.client.prepare('SELECT count(*) AS count FROM host_dispatch_receipts').get()).toEqual({ count: 0 });
    const hitl = f.client.prepare('SELECT continuation FROM hitl_requests').get() as { continuation: string };
    expect(JSON.parse(hitl.continuation)).toMatchObject({
      executionState: 'tool_result_committed',
      hostExecutionCommit: { status: 'approved', executionState: 'tool_result_committed', resultStatus: 'success' },
    });
    await expect(f.adapter.spawn(input)).resolves.toEqual({ kind: 'unresolved', reason: 'recovery_required' });
    expect(f.executions.spawn).toBe(1);
  });

  it('retains an actual failed spawn receipt and terminal journal without claiming a spawn', async () => {
    const f = fixture({ spawnError: true });
    const pending = f.adapter.spawn({ binding, command, leafId: 'spawn-leaf', callId: 'spawn-call',
      emit: f.emit, signal: new AbortController().signal });
    await f.approve(pending);
    await expect(pending).resolves.toMatchObject({ kind: 'not_spawned', replayed: false,
      evidence: { commit: { status: 'error' }, journal: { status: 'failed', phase: 'failed' } } });
    expect(f.client.prepare('SELECT status FROM chat_runs').get()).toEqual({ status: 'failed' });
    expect(toolResultCount(f.client)).toBe(1);
  });

  it('returns a killed terminal as evidence without a completion proof', async () => {
    const f = fixture({ outputStatus: 'killed' }); const signal = new AbortController().signal;
    const spawn = f.adapter.spawn({ binding, command, leafId: 'spawn-leaf', callId: 'spawn-call', emit: f.emit, signal });
    await f.approve(spawn); const spawned = await spawn;
    if (spawned.kind !== 'spawned') throw new Error('expected spawn');
    const result = await f.adapter.poll({ binding, scope: spawned.scope, terminalRouteRef: spawned.terminalRouteRef,
      leafId: 'output-leaf', callId: 'output-call', waitMs: 30_000, emit: f.emit, signal });
    expect(result).toMatchObject({ kind: 'killed', replayed: false });
    expect(result).not.toHaveProperty('scopeProofRef');
  });

  it('replays reconstructed output evidence without another dispatcher execution', async () => {
    const f = fixture(); const signal = new AbortController().signal;
    const spawn = f.adapter.spawn({ binding, command, leafId: 'spawn-leaf', callId: 'spawn-call',
      emit: f.emit, signal });
    await f.approve(spawn); const spawned = await spawn;
    if (spawned.kind !== 'spawned') throw new Error('expected spawn');
    const input = { binding, scope: spawned.scope, terminalRouteRef: spawned.terminalRouteRef,
      leafId: 'output-leaf', callId: 'output-call', waitMs: 30_000,
      emit: f.emit, signal };
    await f.adapter.poll(input);
    const before = f.client.prepare('SELECT count(*) AS count FROM chat_runs').get();
    const replayed = await f.adapter.poll(input);
    expect(replayed).toMatchObject({ kind: 'exited', exitCode: 0, replayed: true });
    expect(f.executions.output).toBe(1);
    expect(f.client.prepare('SELECT count(*) AS count FROM chat_runs').get()).toEqual(before);
  });

  it('leaves output unresolved without opening a journal or dispatching output', async () => {
    const f = fixture(); const signal = new AbortController().signal;
    const spawn = f.adapter.spawn({ binding, command, leafId: 'spawn-leaf', callId: 'spawn-call',
      emit: f.emit, signal });
    await f.approve(spawn); const spawned = await spawn;
    if (spawned.kind !== 'spawned') throw new Error('expected spawn');
    const before = f.client.prepare('SELECT count(*) AS count FROM chat_runs').get();
    f.route.forceUnresolved = true;
    await expect(f.adapter.poll({ binding, scope: spawned.scope, terminalRouteRef: spawned.terminalRouteRef,
      leafId: 'output-leaf', callId: 'output-call', waitMs: 30_000,
      emit: f.emit, signal }))
      .resolves.toEqual({ kind: 'unresolved', reason: 'missing_durable_state' });
    expect(f.executions.output).toBe(0);
    expect(f.client.prepare('SELECT count(*) AS count FROM chat_runs').get()).toEqual(before);
  });

  it('rejects an externally supplied worker observer before route admission', async () => {
    const f = fixture();
    const injected = { binding, command, leafId: 'spawn-leaf', callId: 'spawn-call', emit: f.emit,
      signal: new AbortController().signal, observer: captureObserver().observer } as HostBuildSpawnInput & {
        observer: HostRuntimeReceiptObserver;
      };
    await expect(f.adapter.spawn(injected)).rejects.toThrow('HOST_BUILD_EXTERNAL_OBSERVER_FORBIDDEN');
    expect(f.client.prepare('SELECT count(*) AS count FROM chat_runs').get()).toEqual({ count: 0 });
  });

  it.each([
    ['closed', { closedObserver: true }, 'OBSERVER_CLOSED'],
    ['invalid', { invalidObserver: true }, 'HOST_BUILD_OBSERVER_INVALID'],
  ] as const)('fails a %s factory capability without executing the registry tool', async (_kind, options, error) => {
    const f = fixture(options);
    await expect(f.adapter.spawn({ binding, command, leafId: 'spawn-leaf', callId: 'spawn-call',
      emit: f.emit, signal: new AbortController().signal })).rejects.toThrow(error);
    expect(f.executions.spawn).toBe(0);
    expect(f.client.prepare('SELECT status FROM chat_runs').get()).toEqual({ status: 'failed' });
  });

  it('sanitizes a route abort reason before opening a journal', async () => {
    const controller = new AbortController(); const f = fixture(); f.route.abortOnClaim = controller;
    await expect(f.adapter.spawn({ binding, command, leafId: 'spawn-leaf', callId: 'spawn-call',
      emit: f.emit, signal: controller.signal })).rejects.toThrow('HOST_BUILD_ABORTED');
    expect(f.client.prepare('SELECT count(*) AS count FROM chat_runs').get()).toEqual({ count: 0 });
  });

  it('interrupts the real journal and never returns a normal result when the dispatcher aborts', async () => {
    const controller = new AbortController(); const f = fixture({ abortDuringSpawn: controller });
    const pending = f.adapter.spawn({ binding, command, leafId: 'spawn-leaf', callId: 'spawn-call',
      emit: f.emit, signal: controller.signal });
    await expect((async () => { await f.approve(pending); return pending; })()).rejects.toThrow('HOST_BUILD_ABORTED');
    expect(f.executions.spawn).toBe(1);
    expect(f.client.prepare('SELECT status, phase FROM chat_runs').get()).toEqual({ status: 'interrupted', phase: 'interrupted' });
    expect(toolResultCount(f.client)).toBe(1);
  });

  it('interrupts without draining or completing when stop arrives after both commit acknowledgements', async () => {
    const controller = new AbortController(); const f = fixture({ abortAfterCommit: controller });
    const pending = f.adapter.spawn({ binding, command, leafId: 'spawn-leaf', callId: 'spawn-call',
      emit: f.emit, signal: controller.signal });
    await expect(f.approve(pending)).rejects.toThrow('HOST_BUILD_ABORTED');
    const capture = f.captures.get('spawn-call');
    expect(capture?.commits).toHaveLength(1);
    expect(f.client.prepare('SELECT count(*) AS count FROM host_dispatch_receipts').get()).toEqual({ count: 1 });
    expect(capture?.drainCalls).toHaveLength(0);
    expect(capture?.journalCompleteCalls).toHaveLength(0);
    expect(f.client.prepare('SELECT status, phase FROM chat_runs').get())
      .toEqual({ status: 'interrupted', phase: 'interrupted' });
  });
});

function toolResultCount(client: Database.Database): number {
  return (client.prepare("SELECT count(*) AS count FROM messages WHERE role = 'tool_result'").get() as { count: number }).count;
}
