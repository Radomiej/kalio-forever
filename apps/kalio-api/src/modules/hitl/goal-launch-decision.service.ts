import { BadRequestException, ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { parseGoalLaunchBrowserDecisionOrigin, parseGoalLaunchDecisionInput, parseGoalLaunchDisclosureEnvelope,
  parseGoalLaunchDisclosureV1, parseGoalLaunchHostRequirement,
  type GoalLaunchDecisionInput, type GoalLaunchDisclosureV1, type GoalLaunchHostRequirement } from '@kalio/types';
import type { KalioDrizzleDatabase } from '../../database/sqlite-runtime';
import { DecisionAuthService, type DecisionAuthRequest } from '../../common/decision-auth.service';
import { canonicalGoalLaunchJson, hashGoalLaunchJson } from '../../common/goal-launch-canonical';
import { assertGoalLaunchWaitingSource } from '../../common/goal-launch-waiting-source';

import type { GoalLaunchSnapshotPort } from '../../common/goal-launch-snapshot';
export type { GoalLaunchCurrentSnapshot, GoalLaunchSnapshotPort } from '../../common/goal-launch-snapshot';
export interface GoalLaunchDecisionResult {
  requestId: string; sessionId: string; disclosureId: string; status: 'approved' | 'denied'; revision: number;
}
interface StoredRow {
  id: string; kind: string; status: string; sessionId: string; runId: string | null; turnId: string | null;
  toolCallId: string | null; revision: number; payload: string; continuation: string | null; outcome: string | null;
  createdAt: number; updatedAt: number; resolvedAt: number | null; payloadBytes: Uint8Array; continuationBytes: Uint8Array | null;
}
interface Captured {
  row: StoredRow; payload: Record<string, unknown>; continuation: Record<string, unknown>;
}
function conflict(): never {
  throw new ConflictException({ code: 'GOAL_LAUNCH_DECISION_CONFLICT', message: 'GOAL_LAUNCH_DECISION_CONFLICT' });
}
function persistence(): never {
  throw new ServiceUnavailableException({ code: 'GOAL_LAUNCH_DECISION_PERSISTENCE_FAILED', message: 'GOAL_LAUNCH_DECISION_PERSISTENCE_FAILED' });
}
function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ConflictException({ code: 'GOAL_LAUNCH_DECISION_ABORTED', message: 'GOAL_LAUNCH_DECISION_ABORTED' });
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function read(db: Pick<KalioDrizzleDatabase, 'get'>, id: string): StoredRow | undefined {
  return db.get<StoredRow>(sql`SELECT id,kind,status,session_id AS sessionId,run_id AS runId,turn_id AS turnId,
    tool_call_id AS toolCallId,revision,payload,continuation,outcome,created_at AS createdAt,updated_at AS updatedAt,
    resolved_at AS resolvedAt,CAST(payload AS BLOB) AS payloadBytes,CAST(continuation AS BLOB) AS continuationBytes
    FROM hitl_requests WHERE id=${id}`);
}
function parseStored(text: string | null, bytes: Uint8Array | null): Record<string, unknown> {
  if (typeof text !== 'string' || !(bytes instanceof Uint8Array)
    || !Buffer.from(bytes).equals(Buffer.from(text, 'utf8'))) return conflict();
  try {
    const value: unknown = JSON.parse(text);
    if (!record(value)) return conflict();
    return value;
  } catch { return conflict(); }
}
function capture(row: StoredRow | undefined, input: GoalLaunchDecisionInput): Captured {
  if (!row || row.id !== input.requestId || row.sessionId !== input.sessionId || row.kind !== 'tool_confirmation'
    || row.status !== 'pending' || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision >= Number.MAX_SAFE_INTEGER
    || !row.toolCallId || row.outcome !== null || row.resolvedAt !== null) return conflict();
  const payload = parseStored(row.payload, row.payloadBytes);
  const continuation = parseStored(row.continuation, row.continuationBytes);
  const marker = continuation['hostConfirmationRequirement'];
  if (payload['toolName'] !== 'run_sub_agentflow' || !record(marker) || marker['kind'] !== 'human_only'
    || marker['toolName'] !== 'run_sub_agentflow' || marker['callId'] !== row.toolCallId
    || continuation['executionState'] !== 'pending' || Object.hasOwn(continuation, 'approvalOrigin')
    || Object.hasOwn(continuation, 'hostExecutionCommit')) return conflict();
  try {
    const envelope = parseGoalLaunchDisclosureEnvelope(payload['goalLaunchDisclosure']);
    if (envelope.disclosureId !== input.disclosureId) return conflict();
  } catch { return conflict(); }
  return { row, payload, continuation };
}
function sameRow(a: StoredRow, b: StoredRow): boolean {
  // Exact SQLite projection (including raw JSON and UTF-8 BLOBs), not canonical semantic equality.
  return Object.keys(a).every(key => {
    const field = key as keyof StoredRow;
    const left = a[field]; const right = b[field];
    return left instanceof Uint8Array ? right instanceof Uint8Array && Buffer.from(left).equals(Buffer.from(right)) : left === right;
  });
}
function approval(captured: Captured): { requirement: GoalLaunchHostRequirement; disclosure: GoalLaunchDisclosureV1 } {
  try {
    // Strict canonical detach BEFORE the asynchronous port receives a separate copy.
    const requirement = parseGoalLaunchHostRequirement(JSON.parse(canonicalGoalLaunchJson(captured.continuation['hostConfirmationRequirement'])));
    const disclosure = parseGoalLaunchDisclosureV1(JSON.parse(canonicalGoalLaunchJson(captured.payload['goalLaunchDisclosure'])));
    return { requirement, disclosure };
  } catch { return conflict(); }
}
function verifySnapshot(raw: unknown, requirement: GoalLaunchHostRequirement): void {
  try {
    const snapshot: unknown = JSON.parse(canonicalGoalLaunchJson(raw));
    if (!record(snapshot) || snapshot['status'] !== 'eligible'
      || Object.keys(snapshot).length !== 7
      || !['status', 'flowDefinitionId', 'schemaId', 'policyId', 'flowDefinition', 'schemaDefinition', 'policy'].every(key => Object.hasOwn(snapshot, key))) return conflict();
    const binding = requirement.goalLaunch;
    if (snapshot['flowDefinitionId'] !== binding.flowDefinitionId || snapshot['schemaId'] !== binding.schemaId || snapshot['policyId'] !== binding.policyId
      || hashGoalLaunchJson(snapshot['flowDefinition']) !== binding.flowDefinitionSha256
      || hashGoalLaunchJson(snapshot['schemaDefinition']) !== binding.schemaDefinitionSha256
      || hashGoalLaunchJson(snapshot['policy']) !== binding.policySha256) return conflict();
  } catch { return conflict(); }
}

/** Decision only. No executor, claim, child creation, reservation or default snapshot authority. */
export class GoalLaunchDecisionService {
  constructor(private readonly db: KalioDrizzleDatabase, private readonly auth: DecisionAuthService,
    private readonly snapshots: GoalLaunchSnapshotPort) {
    if (!snapshots || typeof snapshots.readCurrent !== 'function') persistence();
  }

  private authenticate(request: DecisionAuthRequest): void {
    if (!this.auth.isBrowserDecisionAuthorized(request)) throw new UnauthorizedException({
      code: 'GOAL_LAUNCH_DECISION_AUTH_REQUIRED', message: 'GOAL_LAUNCH_DECISION_AUTH_REQUIRED',
    });
  }

  async decide(rawBody: unknown, request: DecisionAuthRequest, signal?: AbortSignal): Promise<GoalLaunchDecisionResult> {
    abort(signal); this.authenticate(request);
    let input: GoalLaunchDecisionInput;
    try { input = parseGoalLaunchDecisionInput(JSON.parse(canonicalGoalLaunchJson(rawBody))); }
    catch { throw new BadRequestException({ code: 'GOAL_LAUNCH_DECISION_INVALID', message: 'GOAL_LAUNCH_DECISION_INVALID' }); }
    let row: StoredRow | undefined;
    try { row = read(this.db, input.requestId); } catch { abort(signal); return persistence(); }
    const captured = capture(row, input);
    const verified = input.decision === 'approve' ? approval(captured) : undefined;
    if (verified) {
      let snapshot: unknown;
      try { snapshot = await this.snapshots.readCurrent(structuredClone(verified.requirement), signal); }
      catch { abort(signal); return persistence(); }
      abort(signal); verifySnapshot(snapshot, verified.requirement);
    }
    abort(signal); this.authenticate(request);
    try {
      return this.db.transaction(tx => {
        abort(signal);
        const current = capture(read(tx, input.requestId), input);
        if (!sameRow(captured.row, current.row)) return conflict();
        if (verified) {
          try { assertGoalLaunchWaitingSource(tx, { requestId: input.requestId, requestRevision: current.row.revision,
            requirement: structuredClone(verified.requirement), disclosure: structuredClone(verified.disclosure) }, signal); }
          catch { abort(signal); return conflict(); }
        }
        abort(signal);
        const status = input.decision === 'approve' ? 'approved' as const : 'denied' as const;
        const origin = verified ? parseGoalLaunchBrowserDecisionOrigin({ schemaVersion: 1, kind: 'decision_browser_goal_launch',
          authorityMode: 'browser_cookie', requestId: current.row.id, sessionId: current.row.sessionId,
          toolCallId: current.row.toolCallId, disclosureId: input.disclosureId, approvedFromRevision: current.row.revision }) : undefined;
        const nextContinuation = origin ? JSON.stringify({ ...current.continuation, approvalOrigin: origin }) : current.row.continuation;
        const outcome = Object.hasOwn(input, 'message') ? JSON.stringify({ message: input.message }) : null;
        const now = Date.now();
        const result = tx.run(sql`UPDATE hitl_requests SET status=${status},revision=revision+1,
          continuation=${nextContinuation},outcome=${outcome},updated_at=${now},resolved_at=${now}
          WHERE id=${input.requestId} AND session_id=${input.sessionId} AND status='pending'
          AND revision=${current.row.revision} AND payload=${current.row.payload} AND continuation=${current.row.continuation}`);
        if (result.changes !== 1) return conflict();
        const final = read(tx, input.requestId);
        if (!final || final.id !== current.row.id || final.sessionId !== current.row.sessionId || final.kind !== current.row.kind
          || final.runId !== current.row.runId || final.turnId !== current.row.turnId || final.toolCallId !== current.row.toolCallId
          || final.revision !== current.row.revision + 1 || final.status !== status || final.payload !== current.row.payload
          || !Buffer.from(final.payloadBytes).equals(Buffer.from(current.row.payloadBytes))
          || final.continuation !== nextContinuation || final.outcome !== outcome || final.createdAt !== current.row.createdAt
          || final.updatedAt !== now || final.resolvedAt !== now) return conflict();
        parseStored(final.continuation, final.continuationBytes);
        abort(signal);
        return { requestId: input.requestId, sessionId: input.sessionId, disclosureId: input.disclosureId, status, revision: final.revision };
      }, { behavior: 'immediate' });
    } catch (error) {
      abort(signal);
      if (error instanceof ConflictException) throw error;
      return persistence();
    }
  }
}
