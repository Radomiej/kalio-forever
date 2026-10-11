import type {
  CompletedChatRunRecord,
  DurableToolResultRecord,
  HostRuntimeReceiptIdentity,
  HostRuntimeReceiptObserver,
  HostRuntimeToolCommit,
  TerminalChatRunRecord,
} from '@kalio/types';
import type { EmitFn } from './interfaces/stream-context.interface';

export interface HostApprovedBuildCommand {
  executable: string;
  argv: string[];
  canonicalCwd: string;
  shell: boolean;
  approvedSourceLocator: string;
  commandFingerprint: string;
  policyFingerprint: string;
}

export interface HostBuildExecutionBinding {
  runId: string;
  nodeId: string;
  attemptId: string;
  goalVersion: number;
  goalFingerprint: string;
  expectedGoalRevision: number;
  sessionId: string;
}

export interface BoundHostBuildScope {
  scopeBindingRef: string;
  command: HostApprovedBuildCommand;
}

export interface GoalHostBuildScopeGuardPort {
  bindExact(input: Readonly<{
    binding: HostBuildExecutionBinding;
    command: HostApprovedBuildCommand;
    signal: AbortSignal;
  }>): Promise<BoundHostBuildScope>;
  verifyCurrent(input: Readonly<{
    binding: HostBuildExecutionBinding;
    scope: BoundHostBuildScope;
    phase: 'before_output' | 'after_terminal';
    signal: AbortSignal;
  }>): Promise<Readonly<{ scopeProofRef: string }>>;
}

export interface HostBuildRouteOwner extends HostBuildExecutionBinding {
  scopeBindingRef: string;
  commandFingerprint: string;
  policyFingerprint: string;
}

export interface TerminalExecutionOwner {
  sessionId: string;
  turnId: string;
  callId: string;
}

export interface PersistedHostBuildLeaf {
  leafId: string;
  journalRunId: string;
  sessionId: string;
  turnId: string;
  promptMessageId: string;
  assistantMessageId: string;
  callId: string;
  toolName: 'terminal_spawn' | 'terminal_output';
  journalRevision: number;
  journalStatus: 'completed' | 'failed' | 'interrupted';
  journalPhase: 'completed' | 'failed' | 'interrupted';
}

export interface HostBuildLeafEvidence {
  leaf: PersistedHostBuildLeaf;
  toolResult: DurableToolResultRecord;
  journal: CompletedChatRunRecord | TerminalChatRunRecord;
  commit: HostRuntimeToolCommit;
}

export type HostBuildClaimUnresolved = Readonly<{
  kind: 'unresolved';
  reason: 'in_flight' | 'missing_durable_state' | 'recovery_required';
}>;
export type FreshHostBuildSpawnClaim = Readonly<{ kind: 'fresh'; claimRef: string }>;
export type FreshHostBuildOutputClaim = Readonly<{
  kind: 'fresh';
  claimRef: string;
  terminalId: string;
  terminalOwner: TerminalExecutionOwner;
}>;
export type ReplayHostBuildClaim = Readonly<{
  kind: 'replay';
  claimRef: string;
  persistedLeafRef: string;
}>;

export interface HostBuildReadbackBase {
  owner: HostBuildRouteOwner;
  leaf: PersistedHostBuildLeaf;
  evidence: HostBuildLeafEvidence;
}
export type HostBuildSpawnReadback =
  | (HostBuildReadbackBase & Readonly<{ kind: 'not_spawned' }>)
  | (HostBuildReadbackBase & Readonly<{
      kind: 'spawned';
      terminalOwner: TerminalExecutionOwner;
      terminalRouteRef: string;
    }>);
export type HostBuildOutputReadback =
  | (HostBuildReadbackBase & Readonly<{
      kind: 'not_observed' | 'running' | 'killed';
      terminalOwner: TerminalExecutionOwner;
      terminalRouteRef: string;
    }>)
  | (HostBuildReadbackBase & Readonly<{
      kind: 'exited';
      exitCode: number | null;
      terminalOwner: TerminalExecutionOwner;
      terminalRouteRef: string;
    }>);

export type SpawnClaim = FreshHostBuildSpawnClaim | ReplayHostBuildClaim;
export type OutputClaim = FreshHostBuildOutputClaim | ReplayHostBuildClaim;
export type SpawnReadbackInput =
  | Readonly<{ claim: FreshHostBuildSpawnClaim; persistedLeaf: PersistedHostBuildLeaf; signal: AbortSignal }>
  | Readonly<{ claim: ReplayHostBuildClaim; signal: AbortSignal }>;
export type OutputReadbackInput =
  | Readonly<{ claim: FreshHostBuildOutputClaim; persistedLeaf: PersistedHostBuildLeaf; signal: AbortSignal }>
  | Readonly<{ claim: ReplayHostBuildClaim; signal: AbortSignal }>;

export interface TrustedHostBuildRoutePort {
  claimSpawn(input: Readonly<{
    owner: HostBuildRouteOwner;
    leafId: string;
    callId: string;
    signal: AbortSignal;
  }>): Promise<SpawnClaim | HostBuildClaimUnresolved>;
  readbackSpawn(input: SpawnReadbackInput): Promise<HostBuildSpawnReadback>;
  claimOutput(input: Readonly<{
    owner: HostBuildRouteOwner;
    scope: BoundHostBuildScope;
    terminalRouteRef: string;
    leafId: string;
    callId: string;
    waitMs: number;
    signal: AbortSignal;
  }>): Promise<OutputClaim | HostBuildClaimUnresolved>;
  readbackOutput(input: OutputReadbackInput): Promise<HostBuildOutputReadback>;
}

export interface CommonHostBuildInput {
  binding: HostBuildExecutionBinding;
  leafId: string;
  callId: string;
  emit: EmitFn;
  signal: AbortSignal;
}
export interface HostBuildSpawnInput extends CommonHostBuildInput { command: HostApprovedBuildCommand }
export interface HostBuildPollInput extends CommonHostBuildInput {
  scope: BoundHostBuildScope;
  terminalRouteRef: string;
  waitMs: number;
}
export type HostBuildSpawnResult = HostBuildClaimUnresolved
  | (HostBuildSpawnReadback & Readonly<{ replayed: boolean; scope: BoundHostBuildScope }>);
export type HostBuildPollResult = HostBuildClaimUnresolved
  | (HostBuildOutputReadback & Readonly<{ replayed: boolean; scopeProofRef?: string }>);

export interface HostBuildReceiptObserverFactoryInput {
  binding: HostBuildExecutionBinding;
  scope: BoundHostBuildScope;
  identity: HostRuntimeReceiptIdentity;
  signal: AbortSignal;
}

export interface ChatOwnedHostBuildExecutionDependencies {
  journals: import('./run-journal.service').RunJournalService;
  sessions: import('./session-manager.service').SessionManagerService;
  toolDispatch: import('./tool-dispatch.service').ToolDispatchService;
  dispatchReceipts: Pick<import('./host-dispatch-receipt.service').HostDispatchReceiptService, 'recorder'>;
  scopeGuard: GoalHostBuildScopeGuardPort;
  route: TrustedHostBuildRoutePort;
  openReceiptObserver(input: Readonly<HostBuildReceiptObserverFactoryInput>): Promise<HostRuntimeReceiptObserver>;
}
