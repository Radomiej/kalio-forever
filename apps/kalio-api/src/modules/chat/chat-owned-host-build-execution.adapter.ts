import { types } from 'node:util';
import { nanoid } from 'nanoid';
import type {
  HostResolvedToolDispatch,
  HostRuntimeReceiptIdentity,
  HostRuntimeReceiptObserver,
  HostRuntimeToolAdmission,
  HostRuntimeToolCommit,
  LLMToolCall,
  ToolResult,
} from '@kalio/types';
import type { StreamContext } from './interfaces/stream-context.interface';
import { dispatchRuntimeTool, TurnExecutionLane } from './llm-turn-tool-execution';
import type { LLMAgentLoopRequest } from './llm-turn-runtime.types';
import { TurnState } from './turn-state';
import type {
  BoundHostBuildScope,
  ChatOwnedHostBuildExecutionDependencies,
  CommonHostBuildInput,
  HostApprovedBuildCommand,
  HostBuildExecutionBinding,
  HostBuildOutputReadback,
  HostBuildPollInput,
  HostBuildPollResult,
  HostBuildReadbackBase,
  HostBuildRouteOwner,
  HostBuildSpawnInput,
  HostBuildSpawnReadback,
  HostBuildSpawnResult,
  PersistedHostBuildLeaf,
  TerminalExecutionOwner,
} from './chat-owned-host-build-execution.types';
export type * from './chat-owned-host-build-execution.types';
interface LeafExecutionInput extends CommonHostBuildInput {
  owner: HostBuildRouteOwner;
  scope: BoundHostBuildScope;
  toolName: PersistedHostBuildLeaf['toolName'];
  args: Record<string, unknown>;
  humanOnly: boolean;
}
interface TerminalDescriptor {
  terminalId: string;
  executable: string;
  argv: string[];
  actualCwd: string;
  shell: boolean;
  ownerIdentity: TerminalExecutionOwner;
}
interface LeafTerminalJournal {
  revision: number;
  status: PersistedHostBuildLeaf['journalStatus'];
  phase: PersistedHostBuildLeaf['journalPhase'];
}
export class ChatOwnedHostBuildExecutionAdapter {
  private readonly usedObservers = new WeakSet<object>();
  constructor(private readonly dependencies: ChatOwnedHostBuildExecutionDependencies) {}

  async spawn(input: HostBuildSpawnInput): Promise<HostBuildSpawnResult> {
    const binding = checkedBinding(input.binding);
    const command = checkedCommand(input.command);
    checkedCommon(input);
    assertNotAborted(input.signal);
    const scope = checkedScope(await abortBound(input.signal,
      () => this.dependencies.scopeGuard.bindExact({ binding, command, signal: input.signal })));
    if (!sameCommand(scope.command, command)) fail('HOST_BUILD_SCOPE_MISMATCH');
    const owner = routeOwner(binding, scope, command);
    const claim = await abortBound(input.signal,
      () => this.dependencies.route.claimSpawn({ owner, leafId: input.leafId, callId: input.callId, signal: input.signal }));
    if (claim.kind === 'unresolved') return claim;
    if (!nonempty(claim.claimRef) || (claim.kind === 'replay' && !nonempty(claim.persistedLeafRef))) fail('HOST_BUILD_CLAIM_INVALID');
    const persistedLeaf = claim.kind === 'fresh' ? await this.executeLeaf({
      ...input, binding, owner, scope, toolName: 'terminal_spawn',
      args: { command: command.executable, args: [...command.argv], cwd: command.canonicalCwd }, humanOnly: true,
    }) : null;
    const readback = await abortBound(input.signal, () => claim.kind === 'replay'
      ? this.dependencies.route.readbackSpawn({ claim, signal: input.signal })
      : this.dependencies.route.readbackSpawn({ claim, persistedLeaf: persistedLeaf!, signal: input.signal }));
    const validated = validateSpawnReadback(readback, owner, command, input.leafId, input.callId);
    return { ...validated, replayed: claim.kind === 'replay', scope };
  }
  async poll(input: HostBuildPollInput): Promise<HostBuildPollResult> {
    const binding = checkedBinding(input.binding);
    const scope = checkedScope(input.scope);
    checkedCommon(input);
    if (!nonempty(input.terminalRouteRef) || !Number.isSafeInteger(input.waitMs) || input.waitMs < 0 || input.waitMs > 30_000) {
      fail('HOST_BUILD_INPUT_INVALID');
    }
    assertNotAborted(input.signal);
    await abortBound(input.signal,
      () => this.dependencies.scopeGuard.verifyCurrent({ binding, scope, phase: 'before_output', signal: input.signal }));
    const owner = routeOwner(binding, scope, scope.command);
    const claim = await abortBound(input.signal, () => this.dependencies.route.claimOutput({ owner, scope,
      terminalRouteRef: input.terminalRouteRef, leafId: input.leafId, callId: input.callId,
      waitMs: input.waitMs, signal: input.signal }));
    if (claim.kind === 'unresolved') return claim;
    if (!nonempty(claim.claimRef) || (claim.kind === 'replay' && !nonempty(claim.persistedLeafRef))) fail('HOST_BUILD_CLAIM_INVALID');
    if (claim.kind === 'fresh') {
      if (!nonempty(claim.terminalId)) fail('HOST_BUILD_CLAIM_INVALID');
      checkedTerminalOwner(claim.terminalOwner);
    }
    const persistedLeaf = claim.kind === 'fresh' ? await this.executeLeaf({
      ...input, binding, owner, scope, toolName: 'terminal_output', args: { id: claim.terminalId, waitMs: input.waitMs }, humanOnly: false,
    }) : null;
    const readback = await abortBound(input.signal, () => claim.kind === 'replay'
      ? this.dependencies.route.readbackOutput({ claim, signal: input.signal })
      : this.dependencies.route.readbackOutput({ claim, persistedLeaf: persistedLeaf!, signal: input.signal }));
    const validated = validateOutputReadback(readback, owner, scope.command, input.terminalRouteRef,
      claim.kind === 'fresh' ? claim.terminalOwner : undefined,
      claim.kind === 'fresh' ? claim.terminalId : undefined, input.leafId, input.callId, input.waitMs);
    if (validated.kind !== 'exited') return { ...validated, replayed: claim.kind === 'replay' };
    const proof = await abortBound(input.signal, () => this.dependencies.scopeGuard.verifyCurrent({
      binding, scope, phase: 'after_terminal', signal: input.signal,
    }));
    if (!nonempty(proof.scopeProofRef)) fail('HOST_BUILD_SCOPE_MISMATCH');
    return { ...validated, replayed: claim.kind === 'replay', scopeProofRef: proof.scopeProofRef };
  }
  private async executeLeaf(input: LeafExecutionInput): Promise<PersistedHostBuildLeaf> {
    const turnId = nanoid();
    const promptMessageId = nanoid();
    const assistantMessageId = nanoid();
    const state = new TurnState();
    const call: LLMToolCall = { id: input.callId, name: input.toolName, args: input.args };
    state.addToolCall(call);
    assertNotAborted(input.signal);
    const started = await this.dependencies.journals.startRun({ sessionId: input.binding.sessionId, turnId, runtimeKind: 'chat' });
    const identity: HostRuntimeReceiptIdentity = Object.freeze({
      runId: started.id, sessionId: input.binding.sessionId, turnId, promptMessageId,
    });
    let capturedCommit: HostRuntimeToolCommit | null = null;
    try {
      assertNotAborted(input.signal);
      await this.dependencies.sessions.persistUserMessage(input.binding.sessionId,
        JSON.stringify({ kind: 'host_build_tool', owner: input.owner, toolName: input.toolName, args: input.args }),
        undefined, { turnId, messageId: promptMessageId });
      await this.dependencies.sessions.persistAssistantMessage(input.binding.sessionId, assistantMessageId, state,
        { turnId, promptMessageId });
      const capability = checkedObserver(await abortBound(input.signal, () => this.dependencies.openReceiptObserver({
        binding: input.binding, scope: input.scope, identity, signal: input.signal,
      })));
      if (this.usedObservers.has(capability)) fail('HOST_BUILD_OBSERVER_REUSED');
      this.usedObservers.add(capability);
      const observer = wrapObserver(capability, identity, (commit) => { capturedCommit = commit; });
      const meta = this.dependencies.toolDispatch.getToolMetas().find((candidate) => candidate.name === input.toolName);
      if (!meta) fail('HOST_BUILD_TOOL_UNAVAILABLE');
      const request: LLMAgentLoopRequest = {
        hostRuntimeReceiptObserver: observer, hostDispatchReceiptRecorder: this.dependencies.dispatchReceipts.recorder,
        runtimeKind: 'chat', sessionId: input.binding.sessionId,
        runId: started.id, turnId, promptMessageId, personaId: 'host-build-verifier', effectiveSystemPrompt: '',
        toolMetas: [meta], abortSignal: input.signal, emit: input.emit, maxIterations: 1,
        callbacks: { onToolPending: () => this.checkpointActive(started.id, input.signal, 'tool_pending') },
      };
      const context: StreamContext = {
        sessionId: input.binding.sessionId, runId: started.id, turnId, promptMessageId,
        runtimeKind: 'chat', messageId: assistantMessageId, abortSignal: input.signal, state, emit: input.emit,
        markWaitingForHuman: () => this.checkpointActive(started.id, input.signal, 'tool_pending', 'waiting_for_human'),
        markToolRunning: () => this.checkpointActive(started.id, input.signal, 'tool_running'),
        ...(input.humanOnly ? { hostConfirmationRequirement: {
          kind: 'human_only' as const, toolName: 'terminal_spawn' as const, callId: input.callId,
        } } : {}),
      };
      const lane = new TurnExecutionLane();
      const result = await lane.execute(call.id, call.id, () => dispatchRuntimeTool({ request, call, context, lane,
        sessionManager: this.dependencies.sessions, toolDispatch: this.dependencies.toolDispatch }), true);
      await lane.drain();
      assertNotAborted(input.signal);
      await observer.drain(identity);
      const terminal = await this.closeJournal(started.id, assistantMessageId, result, identity, observer);
      if (!capturedCommit) fail('HOST_BUILD_COMMIT_MISSING');
      assertNotAborted(input.signal);
      return Object.freeze({ leafId: input.leafId, journalRunId: started.id, sessionId: input.binding.sessionId,
        turnId, promptMessageId, assistantMessageId, callId: input.callId, toolName: input.toolName,
        journalRevision: terminal.revision, journalStatus: terminal.status, journalPhase: terminal.phase });
    } catch (error) {
      const current = await this.dependencies.journals.getTurn(input.binding.sessionId, turnId);
      if (current && (current.status === 'active' || current.status === 'waiting_for_human')) {
        if (input.signal.aborted) await this.dependencies.journals.interrupt(started.id, 'Host BUILD execution interrupted');
        else await this.dependencies.journals.fail(started.id, 'HOST_BUILD_EXECUTION_FAILED', errorMessage(error));
      }
      if (input.signal.aborted) fail('HOST_BUILD_ABORTED');
      throw error;
    }
  }
  private async checkpointActive(id: string, signal: AbortSignal, phase: 'tool_pending' | 'tool_running', status: 'active' | 'waiting_for_human' = 'active'): Promise<void> {
    if (signal.aborted) return;
    await this.dependencies.journals.checkpoint(id, { phase, status });
  }

  private async closeJournal(id: string, assistantMessageId: string, result: ToolResult,
    identity: HostRuntimeReceiptIdentity, observer: HostRuntimeReceiptObserver): Promise<LeafTerminalJournal> {
    if (result.status === 'success') {
      const current = await this.requiredJournal(identity.sessionId, identity.turnId);
      if (!positiveInteger(current.revision)) fail('HOST_BUILD_JOURNAL_INVALID');
      const completed = await this.dependencies.journals.completeRequired(id, current.revision,
        { finalText: '', messageId: assistantMessageId });
      if (!positiveInteger(completed.revision) || completed.status !== 'completed' || completed.phase !== 'completed') {
        fail('HOST_BUILD_JOURNAL_INVALID');
      }
      const sealed = completed as typeof completed & { revision: number; status: 'completed'; phase: 'completed' };
      await observer.journalComplete(identity, sealed);
      return { revision: sealed.revision, status: sealed.status, phase: sealed.phase };
    }
    if (result.status === 'cancelled') await this.dependencies.journals.interrupt(id, result.errorMessage ?? 'Host tool cancelled');
    else await this.dependencies.journals.fail(id, result.errorCode ?? 'HOST_BUILD_TOOL_FAILED', result.errorMessage ?? 'Host tool failed');
    const terminal = await this.requiredJournal(identity.sessionId, identity.turnId);
    if (!positiveInteger(terminal.revision)
      || (terminal.status !== 'failed' && terminal.status !== 'interrupted')
      || (terminal.phase !== 'failed' && terminal.phase !== 'interrupted')) fail('HOST_BUILD_JOURNAL_INVALID');
    return { revision: terminal.revision, status: terminal.status, phase: terminal.phase };
  }

  private async requiredJournal(sessionId: string, turnId: string) {
    const run = await this.dependencies.journals.getTurn(sessionId, turnId);
    if (!run) fail('HOST_BUILD_JOURNAL_MISSING');
    return run;
  }
}

function wrapObserver(observer: HostRuntimeReceiptObserver, expected: HostRuntimeReceiptIdentity,
  capture: (commit: HostRuntimeToolCommit) => void): HostRuntimeReceiptObserver {
  const wrapped: HostRuntimeReceiptObserver = {
    admit: (receipt: HostRuntimeToolAdmission) => {
      requireIdentity(receipt.identity, expected); return observer.admit(receipt);
    },
    resolvedDispatch: (receipt: HostResolvedToolDispatch) => {
      requireIdentity(receipt.identity, expected);
      return observer.resolvedDispatch ? observer.resolvedDispatch(receipt) : Promise.resolve();
    },
    commit: async (receipt: HostRuntimeToolCommit) => {
      requireIdentity(receipt.identity, expected); await observer.commit(receipt); capture(receipt);
    },
    drain: (identity: HostRuntimeReceiptIdentity) => {
      requireIdentity(identity, expected); return observer.drain(identity);
    },
    journalComplete: (identity: HostRuntimeReceiptIdentity, completed) => {
      requireIdentity(identity, expected); return observer.journalComplete(identity, completed);
    },
  };
  return Object.freeze(wrapped);
}

function validateSpawnReadback(value: HostBuildSpawnReadback, owner: HostBuildRouteOwner, command: HostApprovedBuildCommand,
  leafId: string, callId: string): HostBuildSpawnReadback {
  validateReadbackBase(value, owner, leafId, callId, 'terminal_spawn');
  if (value.kind === 'not_spawned') {
    if (value.evidence.commit.status === 'success') fail('HOST_BUILD_READBACK_INVALID');
    return value;
  }
  if (!nonempty(value.terminalRouteRef)) fail('HOST_BUILD_READBACK_INVALID');
  const terminalOwner = checkedTerminalOwner(value.terminalOwner);
  const dispatch = requireSuccessfulDispatch(value.evidence.commit, 'terminal_spawn', true);
  requireSpawnArgs(dispatch.args, command);
  const data = exactRecord(parseJson(value.evidence.toolResult.content), ['id', 'pid', 'command', 'executionDescriptor']);
  if (!nonempty(data.id) || !Number.isSafeInteger(data.pid) || Number(data.pid) < 1 || !nonempty(data.command)) {
    fail('HOST_BUILD_DESCRIPTOR_INVALID');
  }
  const descriptor = checkedDescriptor(data.executionDescriptor);
  if (data.id !== descriptor.terminalId || !sameTerminalOwner(terminalOwner, descriptor.ownerIdentity)
    || !sameTerminalOwner(terminalOwner, ownerFromLeaf(value.leaf)) || !sameDescriptorCommand(descriptor, command)) {
    fail('HOST_BUILD_DESCRIPTOR_MISMATCH');
  }
  return value;
}

function validateOutputReadback(value: HostBuildOutputReadback, owner: HostBuildRouteOwner, command: HostApprovedBuildCommand,
  routeRef: string, claimedOwner: TerminalExecutionOwner | undefined, claimedTerminalId: string | undefined,
  leafId: string, callId: string, waitMs: number): HostBuildOutputReadback {
  validateReadbackBase(value, owner, leafId, callId, 'terminal_output');
  if (!nonempty(value.terminalRouteRef) || value.terminalRouteRef !== routeRef) fail('HOST_BUILD_READBACK_INVALID');
  const terminalOwner = checkedTerminalOwner(value.terminalOwner);
  if (claimedOwner && !sameTerminalOwner(terminalOwner, claimedOwner)) fail('HOST_BUILD_OWNER_MISMATCH');
  if (value.kind === 'not_observed') {
    if (value.evidence.commit.status === 'success') fail('HOST_BUILD_READBACK_INVALID');
    return value;
  }
  const dispatch = requireSuccessfulDispatch(value.evidence.commit, 'terminal_output', false);
  const data = exactRecord(parseJson(value.evidence.toolResult.content), ['id', 'status', 'exitCode', 'output', 'executionDescriptor']);
  if (!nonempty(data.id) || !['running', 'exited', 'killed'].includes(String(data.status))
    || (data.exitCode !== null && (!Number.isSafeInteger(data.exitCode))) || typeof data.output !== 'string') {
    fail('HOST_BUILD_DESCRIPTOR_INVALID');
  }
  const descriptor = checkedDescriptor(data.executionDescriptor);
  if (claimedTerminalId && descriptor.terminalId !== claimedTerminalId) fail('HOST_BUILD_DESCRIPTOR_MISMATCH');
  requireOutputArgs(dispatch.args, descriptor.terminalId, waitMs);
  if (data.id !== descriptor.terminalId || !sameTerminalOwner(terminalOwner, descriptor.ownerIdentity)
    || !sameDescriptorCommand(descriptor, command)) fail('HOST_BUILD_DESCRIPTOR_MISMATCH');
  if (value.kind === 'running' && data.status !== 'running') fail('HOST_BUILD_READBACK_INVALID');
  if (value.kind === 'killed' && data.status !== 'killed') fail('HOST_BUILD_READBACK_INVALID');
  if (value.kind === 'exited' && (data.status !== 'exited' || value.exitCode !== data.exitCode)) fail('HOST_BUILD_READBACK_INVALID');
  return value;
}

function validateReadbackBase(value: HostBuildReadbackBase, owner: HostBuildRouteOwner, leafId: string,
  callId: string, toolName: PersistedHostBuildLeaf['toolName']): void {
  checkedRouteOwner(value.owner);
  if (!sameOwner(value.owner, owner)) fail('HOST_BUILD_OWNER_MISMATCH');
  const leaf = checkedLeaf(value.leaf);
  if (leaf.leafId !== leafId || leaf.callId !== callId || leaf.toolName !== toolName || leaf.sessionId !== owner.sessionId) {
    fail('HOST_BUILD_LEAF_MISMATCH');
  }
  const evidence = value.evidence;
  if (!sameLeaf(checkedLeaf(evidence.leaf), leaf)) fail('HOST_BUILD_EVIDENCE_MISMATCH');
  const commit = evidence.commit;
  const result = evidence.toolResult;
  if (!sameIdentity(commit.identity, leaf) || commit.callId !== callId || commit.toolName !== toolName
    || result.messageId !== commit.persistedMessageId || result.sessionId !== leaf.sessionId || result.turnId !== leaf.turnId
    || result.promptMessageId !== leaf.promptMessageId || result.toolCallId !== callId || result.role !== 'tool_result'
    || result.contentSha256 !== commit.contentSha256) fail('HOST_BUILD_EVIDENCE_MISMATCH');
  if (commit.resolvedDispatch && !sameIdentity(commit.resolvedDispatch.identity, leaf)) fail('HOST_BUILD_EVIDENCE_MISMATCH');
  const journal = evidence.journal;
  if (journal.chatRunId !== leaf.journalRunId || journal.sessionId !== leaf.sessionId || journal.turnId !== leaf.turnId
    || journal.revision !== leaf.journalRevision || journal.status !== leaf.journalStatus || journal.phase !== leaf.journalPhase
    || journal.promptMessageId !== leaf.promptMessageId) fail('HOST_BUILD_EVIDENCE_MISMATCH');
  if (journal.status === 'completed' && journal.terminalMessageId !== leaf.assistantMessageId) fail('HOST_BUILD_EVIDENCE_MISMATCH');
  if ((commit.status === 'success') !== (journal.status === 'completed')) fail('HOST_BUILD_EVIDENCE_MISMATCH');
}

function requireSuccessfulDispatch(commit: HostRuntimeToolCommit, toolName: string, humanOnly: boolean): HostResolvedToolDispatch {
  if (commit.status !== 'success' || !commit.resolvedDispatch) fail('HOST_BUILD_DISPATCH_INVALID');
  const dispatch: HostResolvedToolDispatch = commit.resolvedDispatch;
  if (dispatch.callId !== commit.callId || dispatch.requestedName !== toolName || dispatch.canonicalName !== toolName
    || dispatch.target.kind !== 'kalio_registry' || dispatch.target.requiresConfirmation !== humanOnly) fail('HOST_BUILD_DISPATCH_INVALID');
  if (humanOnly && (dispatch.approval.kind !== 'durable_confirmation' || commit.registeredCommitAck !== 'acknowledged'
    || !commit.hitlCommit || commit.hitlCommit.status !== 'approved'
    || commit.hitlCommit.executionState !== 'tool_result_committed' || commit.hitlCommit.resultStatus !== 'success'
    || commit.hitlCommit.requestId !== dispatch.approval.requestId
    || commit.hitlCommit.claimedRevision !== dispatch.approval.claimedRevision
    || commit.hitlCommit.committedRevision <= commit.hitlCommit.claimedRevision)) {
    fail('HOST_BUILD_HITL_INVALID');
  }
  if (!humanOnly && (dispatch.approval.kind !== 'non_durable' || dispatch.approval.reason !== 'not_required'
    || commit.hitlCommit !== null)) fail('HOST_BUILD_DISPATCH_INVALID');
  return dispatch;
}
function requireSpawnArgs(raw: unknown, command: HostApprovedBuildCommand): void {
  const args = exactRecord(raw, ['command', 'args', 'cwd']);
  if (args.command !== command.executable || args.cwd !== command.canonicalCwd || !stringArray(args.args)
    || args.args.length !== command.argv.length || !args.args.every((arg, index) => arg === command.argv[index])) fail('HOST_BUILD_DISPATCH_INVALID');
}
function requireOutputArgs(raw: unknown, terminalId: string, waitMs: number): void {
  const args = exactRecord(raw, ['id', 'waitMs']);
  if (args.id !== terminalId || args.waitMs !== waitMs) fail('HOST_BUILD_DISPATCH_INVALID');
}

function checkedDescriptor(raw: unknown): TerminalDescriptor {
  const value = exactRecord(raw, ['terminalId', 'executable', 'argv', 'actualCwd', 'shell', 'ownerIdentity']);
  if (!nonempty(value.terminalId) || !nonempty(value.executable) || !stringArray(value.argv)
    || !nonempty(value.actualCwd) || typeof value.shell !== 'boolean') fail('HOST_BUILD_DESCRIPTOR_INVALID');
  return { terminalId: value.terminalId, executable: value.executable, argv: value.argv,
    actualCwd: value.actualCwd, shell: value.shell, ownerIdentity: checkedTerminalOwner(value.ownerIdentity) };
}

function checkedTerminalOwner(raw: unknown): TerminalExecutionOwner {
  const value = exactRecord(raw, ['sessionId', 'turnId', 'callId']);
  if (!nonempty(value.sessionId) || !nonempty(value.turnId) || !nonempty(value.callId)) fail('HOST_BUILD_OWNER_INVALID');
  return { sessionId: value.sessionId, turnId: value.turnId, callId: value.callId };
}

function checkedLeaf(raw: unknown): PersistedHostBuildLeaf {
  const value = exactRecord(raw, ['leafId', 'journalRunId', 'sessionId', 'turnId', 'promptMessageId', 'assistantMessageId',
    'callId', 'toolName', 'journalRevision', 'journalStatus', 'journalPhase']);
  if (![value.leafId, value.journalRunId, value.sessionId, value.turnId, value.promptMessageId,
    value.assistantMessageId, value.callId].every(nonempty) || !positiveInteger(value.journalRevision)
    || !['terminal_spawn', 'terminal_output'].includes(String(value.toolName))
    || !['completed', 'failed', 'interrupted'].includes(String(value.journalStatus))
    || !['completed', 'failed', 'interrupted'].includes(String(value.journalPhase))) fail('HOST_BUILD_LEAF_INVALID');
  if (value.journalStatus !== value.journalPhase) fail('HOST_BUILD_LEAF_INVALID');
  return value as unknown as PersistedHostBuildLeaf;
}

function checkedBinding(raw: unknown): HostBuildExecutionBinding {
  const value = exactRecord(raw, ['runId', 'nodeId', 'attemptId', 'goalVersion', 'goalFingerprint', 'expectedGoalRevision', 'sessionId']);
  if (![value.runId, value.nodeId, value.attemptId, value.goalFingerprint, value.sessionId].every(nonempty)
    || !positiveInteger(value.goalVersion) || !positiveInteger(value.expectedGoalRevision)) fail('HOST_BUILD_INPUT_INVALID');
  return Object.freeze({ ...value }) as unknown as HostBuildExecutionBinding;
}

function checkedCommand(raw: unknown): HostApprovedBuildCommand {
  const value = exactRecord(raw, ['executable', 'argv', 'canonicalCwd', 'shell', 'approvedSourceLocator', 'commandFingerprint', 'policyFingerprint']);
  if (![value.executable, value.canonicalCwd, value.approvedSourceLocator, value.commandFingerprint, value.policyFingerprint].every(nonempty)
    || !stringArray(value.argv) || typeof value.shell !== 'boolean') fail('HOST_BUILD_INPUT_INVALID');
  return { ...value, argv: [...value.argv] } as HostApprovedBuildCommand;
}

function checkedScope(raw: unknown): BoundHostBuildScope {
  const value = exactRecord(raw, ['scopeBindingRef', 'command']);
  if (!nonempty(value.scopeBindingRef)) fail('HOST_BUILD_SCOPE_INVALID');
  return { scopeBindingRef: value.scopeBindingRef, command: checkedCommand(value.command) };
}

function checkedRouteOwner(raw: unknown): HostBuildRouteOwner {
  const value = exactRecord(raw, ['runId', 'nodeId', 'attemptId', 'goalVersion', 'goalFingerprint', 'expectedGoalRevision',
    'sessionId', 'scopeBindingRef', 'commandFingerprint', 'policyFingerprint']);
  checkedBinding({ runId: value.runId, nodeId: value.nodeId, attemptId: value.attemptId, goalVersion: value.goalVersion,
    goalFingerprint: value.goalFingerprint, expectedGoalRevision: value.expectedGoalRevision, sessionId: value.sessionId });
  if (![value.scopeBindingRef, value.commandFingerprint, value.policyFingerprint].every(nonempty)) fail('HOST_BUILD_OWNER_INVALID');
  return value as unknown as HostBuildRouteOwner;
}

function checkedCommon(input: CommonHostBuildInput): void {
  if (types.isProxy(input) || Object.hasOwn(input, 'observer')) fail('HOST_BUILD_EXTERNAL_OBSERVER_FORBIDDEN');
  if (!nonempty(input.leafId) || !nonempty(input.callId)) {
    fail('HOST_BUILD_INPUT_INVALID');
  }
}

function checkedObserver(raw: unknown): HostRuntimeReceiptObserver {
  if (!raw || typeof raw !== 'object') fail('HOST_BUILD_OBSERVER_INVALID');
  const value = raw as Partial<HostRuntimeReceiptObserver>;
  if (typeof value.admit !== 'function' || typeof value.commit !== 'function' || typeof value.drain !== 'function'
    || typeof value.journalComplete !== 'function'
    || (value.resolvedDispatch !== undefined && typeof value.resolvedDispatch !== 'function')) {
    fail('HOST_BUILD_OBSERVER_INVALID');
  }
  return value as HostRuntimeReceiptObserver;
}

function requireIdentity(actual: HostRuntimeReceiptIdentity, expected: HostRuntimeReceiptIdentity): void {
  if (actual.runId !== expected.runId || actual.sessionId !== expected.sessionId || actual.turnId !== expected.turnId
    || actual.promptMessageId !== expected.promptMessageId) fail('HOST_BUILD_OBSERVER_IDENTITY_MISMATCH');
}

async function abortBound<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  assertNotAborted(signal);
  try {
    const result = await operation();
    assertNotAborted(signal);
    return result;
  } catch (error) {
    if (signal.aborted) fail('HOST_BUILD_ABORTED');
    throw error;
  }
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) fail('HOST_BUILD_ABORTED');
}

function routeOwner(binding: HostBuildExecutionBinding, scope: BoundHostBuildScope, command: HostApprovedBuildCommand): HostBuildRouteOwner {
  return Object.freeze({ ...binding, scopeBindingRef: scope.scopeBindingRef,
    commandFingerprint: command.commandFingerprint, policyFingerprint: command.policyFingerprint });
}

function exactRecord(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || types.isProxy(raw)) fail('HOST_BUILD_DESCRIPTOR_INVALID');
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) fail('HOST_BUILD_DESCRIPTOR_INVALID');
  const own = Reflect.ownKeys(raw);
  if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) fail('HOST_BUILD_DESCRIPTOR_INVALID');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('HOST_BUILD_DESCRIPTOR_INVALID');
  }
  return raw as Record<string, unknown>;
}

function stringArray(raw: unknown): raw is string[] {
  if (!Array.isArray(raw) || types.isProxy(raw) || Reflect.ownKeys(raw).length !== raw.length + 1
    || Reflect.ownKeys(raw).some((key) => key !== 'length'
    && (typeof key !== 'string' || !/^\d+$/.test(key)))) return false;
  for (let index = 0; index < raw.length; index++) if (!Object.hasOwn(raw, index) || !nonempty(raw[index])) return false;
  return true;
}

function parseJson(content: string): unknown {
  try { return JSON.parse(content) as unknown; } catch { return fail('HOST_BUILD_RESULT_JSON_INVALID'); }
}
function ownerFromLeaf(leaf: PersistedHostBuildLeaf): TerminalExecutionOwner {
  return { sessionId: leaf.sessionId, turnId: leaf.turnId, callId: leaf.callId };
}
function sameDescriptorCommand(value: TerminalDescriptor, command: HostApprovedBuildCommand): boolean {
  return value.executable === command.executable && value.actualCwd === command.canonicalCwd && value.shell === command.shell
    && value.argv.length === command.argv.length && value.argv.every((arg, index) => arg === command.argv[index]);
}
function sameTerminalOwner(a: TerminalExecutionOwner, b: TerminalExecutionOwner): boolean {
  return a.sessionId === b.sessionId && a.turnId === b.turnId && a.callId === b.callId;
}
function sameIdentity(identity: HostRuntimeReceiptIdentity, leaf: PersistedHostBuildLeaf): boolean {
  return identity.runId === leaf.journalRunId && identity.sessionId === leaf.sessionId && identity.turnId === leaf.turnId
    && identity.promptMessageId === leaf.promptMessageId;
}
function sameLeaf(a: PersistedHostBuildLeaf, b: PersistedHostBuildLeaf): boolean {
  return a.leafId === b.leafId && a.journalRunId === b.journalRunId && a.sessionId === b.sessionId
    && a.turnId === b.turnId && a.promptMessageId === b.promptMessageId && a.assistantMessageId === b.assistantMessageId
    && a.callId === b.callId && a.toolName === b.toolName && a.journalRevision === b.journalRevision
    && a.journalStatus === b.journalStatus && a.journalPhase === b.journalPhase;
}
function sameOwner(a: HostBuildRouteOwner, b: HostBuildRouteOwner): boolean {
  return a.runId === b.runId && a.nodeId === b.nodeId && a.attemptId === b.attemptId && a.goalVersion === b.goalVersion
    && a.goalFingerprint === b.goalFingerprint && a.expectedGoalRevision === b.expectedGoalRevision && a.sessionId === b.sessionId
    && a.scopeBindingRef === b.scopeBindingRef && a.commandFingerprint === b.commandFingerprint && a.policyFingerprint === b.policyFingerprint;
}
function sameCommand(a: HostApprovedBuildCommand, b: HostApprovedBuildCommand): boolean {
  return a.executable === b.executable && a.canonicalCwd === b.canonicalCwd && a.approvedSourceLocator === b.approvedSourceLocator
    && a.shell === b.shell && a.commandFingerprint === b.commandFingerprint && a.policyFingerprint === b.policyFingerprint
    && a.argv.length === b.argv.length && a.argv.every((arg, index) => arg === b.argv[index]);
}
function positiveInteger(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 1; }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function fail(code: string): never { throw new Error(code); }
