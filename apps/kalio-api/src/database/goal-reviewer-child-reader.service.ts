import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { GoalReviewerChildReader, ReservedReviewerChild } from '../common/goal-reviewer-child-reader.port';
import { DrizzleService } from './drizzle.service';
import { goalReviewerAdmissions, sessions } from './schema';

const unavailable = (): never => { throw new Error('REVIEWER_CHILD_RESERVATION_UNAVAILABLE'); };
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable();
  return value as Record<string, unknown>;
}
function nullableText(value: unknown): boolean { return value === null || text(value); }

/** Unwired reservation classifier. Does NOT validate a fresh goal/worker/policy
 * binding, grant start authority, or replace repository claimStart validation. */

@Injectable()
export class GoalReviewerChildReaderService implements GoalReviewerChildReader {
  constructor(private readonly drizzle: DrizzleService) {}

  readByChildSessionId(childSessionId: string): Readonly<ReservedReviewerChild> | null {
    try {
      if (!text(childSessionId)) return unavailable();
      // Reservation drives the query: deleted children remain reserved failures.
      const found = this.drizzle.db.select({ reservation: goalReviewerAdmissions, child: {
        id: sessions.id, kind: sessions.kind, parentSessionId: sessions.parentSessionId,
        parentToolCallId: sessions.parentToolCallId, parentTurnId: sessions.parentTurnId,
        executionProfileId: sessions.executionProfileId, projectId: sessions.projectId,
        personaId: sessions.personaId, createdAt: sessions.createdAt,
      } }).from(goalReviewerAdmissions)
        .leftJoin(sessions, eq(sessions.id, goalReviewerAdmissions.childSessionId))
        .where(eq(goalReviewerAdmissions.childSessionId, childSessionId)).get();
      if (!found) return null;
      const { reservation: row, child } = found;
      if (!child || !text(row.admissionId) || !text(row.runId) || !text(row.rootSessionId)
        || !text(row.childSessionId) || !text(row.plannedTurnId) || !text(row.sourceFingerprint)
        || !digest(row.workerFingerprint) || !integer(row.goalVersion) || row.goalVersion < 1
        || !integer(row.createdAt) || !digest(row.descriptorSha256) || typeof row.descriptorJson !== 'string'
        || !((row.state === 'admitted' && row.revision === 0)
          || ((row.state === 'started' || row.state === 'cancelled') && row.revision === 1))) return unavailable();
      // Verify original UTF8 bytes. Never hash a parsed/reencoded descriptor.
      if (createHash('sha256').update(row.descriptorJson, 'utf8').digest('hex') !== row.descriptorSha256)
        return unavailable();
      const outer = record(JSON.parse(row.descriptorJson) as unknown);
      if (Object.keys(outer).length !== 4 || outer.childSessionId !== row.childSessionId
        || outer.plannedTurnId !== row.plannedTurnId || outer.createdAt !== row.createdAt) return unavailable();
      const binding = record(outer.binding);
      if (binding.version !== 1) return unavailable();
      const input = record(binding.input);
      const root = record(binding.root);
      const worker = record(binding.worker);
      const profile = record(binding.profile);
      const project = record(binding.project);
      const goal = record(binding.goal);
      const locator = record(input.worker);
      const run = record(binding.run);
      // Only supported metadata shape/linkage, not a reconstruction of binding.
      if (input.runId !== row.runId || input.rootSessionId !== row.rootSessionId
        || !integer(input.expectedStateRevision) || input.expectedStateRevision < 1
        || !digest(input.reviewerPromptFingerprint)
        || goal.runId !== row.runId || goal.rootSessionId !== row.rootSessionId
        || goal.sourceVersion !== row.goalVersion || goal.sourceFingerprint !== row.sourceFingerprint
        || goal.stateRevision !== input.expectedStateRevision
        || root.id !== row.rootSessionId || !text(root.projectId) || !text(root.executionProfileId)
        || !text(worker.id) || worker.parentSessionId !== row.rootSessionId || worker.kind !== 'subagent'
        || worker.projectId !== root.projectId || worker.executionProfileId !== root.executionProfileId
        || !nullableText(worker.personaId) || !nullableText(worker.parentTurnId)
        || !nullableText(worker.parentToolCallId) || !integer(worker.createdAt)
        || profile.id !== root.executionProfileId || profile.kind !== 'devin-cli-acp'
        || !text(profile.model) || profile.enabled !== true
        || project.id !== root.projectId || project.kind !== 'workspace' || !text(project.path)
        || !text(locator.chatRunId) || locator.sessionId !== worker.id || !text(locator.turnId)
        || !integer(locator.revision) || locator.revision < 1 || !text(locator.promptMessageId)
        || !text(locator.terminalMessageId) || run.id !== locator.chatRunId || run.revision !== locator.revision
        || run.executionProfileId !== profile.id || run.model !== profile.model || !integer(run.completedAt)
        || !digest(root.contextSha256) || !digest(worker.contextSha256)
        || !digest(binding.promptSha256) || !digest(binding.terminalSha256)
        || !digest(binding.nativePolicySha256) || binding.reviewerPolicy !== 'no-tools-no-mcp-no-native-v1')
        return unavailable();
      const parentToolCallId = `goal-reviewer:${row.admissionId}`;
      if (child.id !== row.childSessionId || child.kind !== 'subagent'
        || child.parentSessionId !== row.rootSessionId || child.parentToolCallId !== parentToolCallId
        || child.executionProfileId !== profile.id || child.projectId !== root.projectId
        || child.personaId !== worker.personaId || child.parentTurnId !== worker.parentTurnId
        || !(child.createdAt instanceof Date) || child.createdAt.getTime() !== row.createdAt) return unavailable();
      return Object.freeze({ admissionId: row.admissionId, descriptorSha256: row.descriptorSha256,
        childSessionId: row.childSessionId, plannedTurnId: row.plannedTurnId,
        rootSessionId: row.rootSessionId, parentSessionId: row.rootSessionId,
        parentToolCallId, state: row.state, revision: row.revision });
    } catch {
      // Explicitly translate storage/parse errors without leaking DB/payload text.
      return unavailable();
    }
  }
}
