import type { HitlRequestService } from '../hitl/hitl-request.service';
import type { PendingConfirmation } from './tool-confirmation-pending';
import { types } from 'node:util';
import { parseGoalLaunchBrowserDecisionOrigin, parseGoalLaunchDecisionInput,
  parseGoalLaunchDisclosureEnvelope, parseGoalLaunchDisclosureV1, parseGoalLaunchHostRequirement } from '@kalio/types';
import { canonicalGoalLaunchJson, hashGoalLaunchJson } from '../../common/goal-launch-canonical';

/** Row selectors, never authentication, approval, or launch authority. */
export interface CommittedGoalLaunchDecisionSelector {
  readonly requestId: string;
  readonly sessionId: string;
  readonly disclosureId: string;
  readonly committedRevision: number;
}
export type GoalLaunchReconciliationResult = 'settled' | 'not_live' | 'conflict';
export interface GoalLaunchReconciliationDependencies {
  /** Private service-owned entries only. resolve/reject are the nonthrowing Promise
   * settlers installed by awaitToolConfirmation, not arbitrary caller callbacks.
   * A violated owner contract fails closed; removed entries are never reseeded. */
  readonly pending: Map<string, PendingConfirmation>;
  readonly requests: Pick<HitlRequestService, 'getById'>;
  notifySettled: (pending: PendingConfirmation, status: 'approved' | 'denied', message?: string) => void;
  readonly logFailure: () => void;
}

type RecordValue = Record<string, unknown>;
const invalid = (): never => { throw new Error('GOAL_LAUNCH_RECONCILIATION_INVALID'); };
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return invalid();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!('value' in descriptor) || !descriptor.enumerable) return invalid();
  return descriptor.value;
}
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as RecordValue;
}
function detached(value: unknown): RecordValue {
  return record(JSON.parse(canonicalGoalLaunchJson(value)) as unknown);
}
function selector(raw: unknown): CommittedGoalLaunchDecisionSelector {
  const value = detached(raw);
  if (Object.keys(value).length !== 4 || !['requestId', 'sessionId', 'disclosureId', 'committedRevision'].every(key => Object.hasOwn(value, key))) return invalid();
  const ids = parseGoalLaunchDecisionInput({ requestId: value.requestId, sessionId: value.sessionId,
    disclosureId: value.disclosureId, decision: 'reject' });
  const revision = value.committedRevision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) return invalid();
  return { requestId: ids.requestId, sessionId: ids.sessionId, disclosureId: ids.disclosureId, committedRevision: revision };
}
function live(requestId: string, deps: GoalLaunchReconciliationDependencies) {
  const pending = deps.pending.get(requestId);
  if (!pending) return undefined;
  const rawSource = own(pending, 'source'); const signal = own(pending, 'sourceAbortSignal');
  if (!rawSource || !signal) return undefined;
  if (typeof signal !== 'object' || types.isProxy(signal) || !(signal instanceof AbortSignal)) return invalid();
  const source = detached(rawSource);
  const fields = ['runId', 'sessionId', 'turnId', 'promptMessageId', 'assistantMessageId', 'toolCallId', 'toolName'];
  if (Object.keys(source).length !== 9 || fields.some(key => typeof source[key] !== 'string' || !(source[key] as string).trim())
    || source.toolName !== 'run_sub_agentflow' || typeof source.pendingRequestRevision !== 'number'
    || !Number.isSafeInteger(source.pendingRequestRevision) || source.pendingRequestRevision < 1
    || own(pending, 'revision') !== source.pendingRequestRevision || own(pending, 'sessionId') !== source.sessionId) return invalid();
  record(source.args);
  assertPendingIdentity(pending, source, requestId);
  return { pending, source, signal };
}
function assertPendingIdentity(pending: PendingConfirmation, source: RecordValue, requestId: string): void {
  const payload = own(pending, 'payload');
  if (own(payload, 'requestId') !== requestId || own(payload, 'sessionId') !== source.sessionId
    || own(payload, 'toolCallId') !== source.toolCallId || own(payload, 'toolName') !== source.toolName
    || own(payload, 'turnId') !== source.turnId || own(payload, 'promptMessageId') !== source.promptMessageId) return invalid();
}
function readback(raw: unknown): RecordValue {
  // Drizzle dates are capabilities outside JSON; validate with the built-in method, not user getters.
  const resolvedAt = own(raw, 'resolvedAt');
  if (!resolvedAt || typeof resolvedAt !== 'object' || types.isProxy(resolvedAt)
    || !Number.isFinite(Date.prototype.getTime.call(resolvedAt))) return invalid();
  const projection: RecordValue = {};
  for (const key of ['id', 'kind', 'status', 'sessionId', 'runId', 'turnId', 'toolCallId', 'revision', 'payload', 'continuation', 'outcome']) {
    projection[key] = own(raw, key);
  }
  return detached(projection);
}
function validate(row: RecordValue, input: CommittedGoalLaunchDecisionSelector, source: RecordValue) {
  if (row.id !== input.requestId || row.sessionId !== input.sessionId || row.revision !== input.committedRevision
    || row.kind !== 'tool_confirmation' || row.status !== 'approved' && row.status !== 'denied'
    || row.runId !== source.runId || row.sessionId !== source.sessionId || row.turnId !== source.turnId
    || row.toolCallId !== source.toolCallId || typeof row.revision !== 'number'
    || typeof source.pendingRequestRevision !== 'number' || row.revision <= source.pendingRequestRevision) return invalid();
  const payload = record(row.payload); const cursor = record(row.continuation);
  if (payload.toolName !== source.toolName || canonicalGoalLaunchJson(payload.args) !== canonicalGoalLaunchJson(source.args)
    || cursor.version !== 1 || cursor.kind !== 'approved_tool_then_resume_turn' || cursor.phase !== 'tool_pending'
    || cursor.executionState !== 'pending' || Object.hasOwn(cursor, 'hostExecutionCommit')
    || cursor.runId !== source.runId || cursor.sessionId !== source.sessionId || cursor.turnId !== source.turnId
    || cursor.promptMessageId !== source.promptMessageId || cursor.messageId !== source.assistantMessageId) return invalid();
  const marker = record(cursor.hostConfirmationRequirement);
  if (marker.kind !== 'human_only' || marker.toolName !== 'run_sub_agentflow' || marker.callId !== source.toolCallId
    || !Object.hasOwn(marker, 'goalLaunch')) return invalid();
  const envelope = parseGoalLaunchDisclosureEnvelope(payload.goalLaunchDisclosure);
  if (envelope.disclosureId !== input.disclosureId) return invalid();
  let message: string | undefined;
  if (row.outcome !== null) {
    const outcome = record(row.outcome);
    if (Object.keys(outcome).length !== 1 || !Object.hasOwn(outcome, 'message')) return invalid();
    message = parseGoalLaunchDecisionInput({ requestId: input.requestId, sessionId: input.sessionId,
      disclosureId: input.disclosureId, decision: 'reject', message: outcome.message }).message;
  }
  if (row.status === 'denied') {
    if (Object.hasOwn(cursor, 'approvalOrigin')) return invalid();
    // Denial only: future disclosure/private preparing values are not interpreted as approval or HTTP identity.
    return { status: 'denied' as const, message };
  }
  const requirement = parseGoalLaunchHostRequirement(marker);
  const disclosure = parseGoalLaunchDisclosureV1(payload.goalLaunchDisclosure);
  const origin = parseGoalLaunchBrowserDecisionOrigin(cursor.approvalOrigin);
  const binding = requirement.goalLaunch;
  if (binding.parentRunId !== source.runId || binding.parentSessionId !== source.sessionId || binding.parentTurnId !== source.turnId
    || binding.promptMessageId !== source.promptMessageId || binding.assistantMessageId !== source.assistantMessageId
    || binding.argsSha256 !== hashGoalLaunchJson(source.args) || binding.disclosureSha256 !== hashGoalLaunchJson(disclosure)
    || record(source.args).goal !== disclosure.goal || disclosure.preset.id !== binding.flowDefinitionId
    || origin.requestId !== input.requestId || origin.sessionId !== input.sessionId || origin.toolCallId !== source.toolCallId
    || origin.disclosureId !== input.disclosureId || origin.approvedFromRevision !== source.pendingRequestRevision) return invalid();
  return { status: 'approved' as const, message };
}
function logFailure(deps: GoalLaunchReconciliationDependencies): void {
  try { deps.logFailure(); } catch { return; } // Logging cannot undo an already settled promise.
}
async function reconcile(requestId: string, deps: GoalLaunchReconciliationDependencies,
  selected?: CommittedGoalLaunchDecisionSelector): Promise<GoalLaunchReconciliationResult> {
  try {
    const current = live(requestId, deps);
    if (!current) return 'not_live';
    if (current.signal.aborted) return 'conflict';
    let raw: unknown;
    try { raw = await deps.requests.getById(requestId); }
    catch { logFailure(deps); return deps.pending.get(requestId) === current.pending ? 'conflict' : 'not_live'; }
    if (deps.pending.get(requestId) !== current.pending) return 'not_live';
    if (current.signal.aborted) return 'conflict';
    assertPendingIdentity(current.pending, current.source, requestId);
    if (!selected) {
      if (!raw) return 'not_live';
      const cursor = own(raw, 'continuation');
      if (!cursor || own(cursor, 'hostConfirmationRequirement') === undefined) return 'not_live';
      const marker = own(cursor, 'hostConfirmationRequirement');
      if (!marker || own(marker, 'toolName') !== 'run_sub_agentflow' || own(marker, 'goalLaunch') === undefined) return 'not_live';
      const status = own(raw, 'status');
      if (status === 'pending' || status === 'cancelled') return 'not_live';
      const envelope = parseGoalLaunchDisclosureEnvelope(own(own(raw, 'payload'), 'goalLaunchDisclosure'));
      selected = selector({ requestId, sessionId: current.source.sessionId,
        disclosureId: envelope.disclosureId, committedRevision: own(raw, 'revision') });
    }
    const outcome = validate(readback(raw), selected, current.source);
    if (deps.pending.get(requestId) !== current.pending) return 'not_live';
    if (current.signal.aborted) return 'conflict';
    // Linearization is synchronous. No claims, ToolRunning hooks, child creation or Stop rewrites.
    deps.pending.delete(requestId);
    if (outcome.status === 'approved') current.pending.resolve(); else current.pending.reject(outcome.message);
    try { deps.notifySettled(current.pending, outcome.status, outcome.message); }
    catch { logFailure(deps); }
    return 'settled';
  } catch { return 'conflict'; }
}

/** Durable GET + original live waiter check only. Selectors/origin parsers are not launch authority. */
export async function reconcileCommittedGoalLaunchDecision(
  input: CommittedGoalLaunchDecisionSelector, deps: GoalLaunchReconciliationDependencies,
): Promise<GoalLaunchReconciliationResult> {
  try { const selected = selector(input); return await reconcile(selected.requestId, deps, selected); }
  catch { return 'conflict'; }
}

/** Registration catch-up reads actual committed revision; never derives it from waiting revision. */
export async function reconcileRegisteredGoalLaunchWaiter(
  requestId: string, deps: GoalLaunchReconciliationDependencies,
): Promise<GoalLaunchReconciliationResult> { return reconcile(requestId, deps); }
