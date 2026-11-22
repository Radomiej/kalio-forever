import type { CompletedChatRunLocator } from '@kalio/types';
import { and, eq, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { architectureGoalStates, appSettings, chatRuns, executionProfiles, goalReviewerAdmissions,
  messages, projects, sessions } from '../../database/schema';
import type { KalioDrizzleDatabase } from '../../database/sqlite-runtime';
import { sessionTreeStopAdmission } from '../../database/session-tree-stop-admission';

export interface ReviewerAdmissionInput {
  runId: string;
  rootSessionId: string;
  expectedStateRevision: number;
  worker: CompletedChatRunLocator;
  reviewerPromptFingerprint: string;
}
type Admission = typeof goalReviewerAdmissions.$inferSelect;
export type ReviewerAdmissionResult =
  | { kind: 'inserted'; admission: Admission; claimStart(): boolean }
  | { kind: 'existing'; admission: Admission }
  | { kind: 'unavailable' };
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
function unavailable(): never { throw new Error('REVIEWER_ADMISSION_UNAVAILABLE'); }
function descriptor(binding: string, row: Pick<Admission, 'childSessionId' | 'plannedTurnId' | 'createdAt'>): string {
  return JSON.stringify({ binding: JSON.parse(binding) as unknown, childSessionId: row.childSessionId,
    plannedTurnId: row.plannedTurnId, createdAt: row.createdAt });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) unavailable();
  return value;
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) unavailable();
  return value;
}
/** Decode only original input. Full metadata authority is the exact reconstruction
 * using binding()/descriptor() below, never a second descriptor schema. */
function originalInput(json: string): ReviewerAdmissionInput {
  const value: unknown = JSON.parse(json);
  if (!record(value) || !record(value.binding) || value.binding.version !== 1
    || !record(value.binding.input) || !record(value.binding.input.worker)) unavailable();
  const input = value.binding.input;
  const worker = input.worker;
  if (!record(worker)) unavailable();
  const canonical: ReviewerAdmissionInput = { runId: text(input.runId), rootSessionId: text(input.rootSessionId),
    expectedStateRevision: positive(input.expectedStateRevision), reviewerPromptFingerprint: text(input.reviewerPromptFingerprint),
    worker: { chatRunId: text(worker.chatRunId), sessionId: text(worker.sessionId), turnId: text(worker.turnId),
      revision: positive(worker.revision), promptMessageId: text(worker.promptMessageId), terminalMessageId: text(worker.terminalMessageId) } };
  if (JSON.stringify(canonical) !== JSON.stringify(input)) unavailable();
  return canonical;
}

/** Unwired durable storage. No provider calls, goal acceptance or completion proof.
 * The insert winner alone receives a one-use start closure AFTER commit. Reopened
 * or orphaned rows are read-only: there is deliberately no resume/retry API. */
export class ArchitectureGoalReviewerRepository {
  constructor(private readonly db: KalioDrizzleDatabase) {}

  /** Read validation only: never mints launch, completion or retry authority. */
  assertStartedCurrent(admissionId: string, descriptorSha256: string): void {
    try {
      text(admissionId);
      if (typeof descriptorSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(descriptorSha256)) unavailable();
      // Own a deferred read snapshot. BEGIN failure (including an outer caller
      // transaction) must not commit or roll back somebody else's work.
      this.db.run(sql`BEGIN DEFERRED`);
      try {
        const row = this.db.select().from(goalReviewerAdmissions)
          .where(eq(goalReviewerAdmissions.admissionId, admissionId)).get();
        if (!row || row.admissionId !== admissionId || row.state !== 'started' || row.revision !== 1
          || row.descriptorSha256 !== descriptorSha256 || hash(row.descriptorJson) !== descriptorSha256
          || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0) unavailable();
        text(row.childSessionId); text(row.plannedTurnId);
        const input = originalInput(row.descriptorJson);
        const current = this.binding(input);
        if (row.runId !== input.runId || row.rootSessionId !== input.rootSessionId
          || row.goalVersion !== current.goal.sourceVersion || row.sourceFingerprint !== current.goal.sourceFingerprint
          || row.workerFingerprint !== current.workerFingerprint
          || descriptor(current.json, row) !== row.descriptorJson || !this.childCurrent(row, current)) unavailable();
        this.db.run(sql`COMMIT`);
      } catch {
        this.db.run(sql`ROLLBACK`);
        unavailable();
      }
    } catch { unavailable(); }
  }

  admit(raw: ReviewerAdmissionInput): ReviewerAdmissionResult {
    try {
      const copy = structuredClone(raw);
      const input: ReviewerAdmissionInput = { runId: copy.runId, rootSessionId: copy.rootSessionId,
        expectedStateRevision: copy.expectedStateRevision, reviewerPromptFingerprint: copy.reviewerPromptFingerprint,
        worker: { chatRunId: copy.worker.chatRunId, sessionId: copy.worker.sessionId, turnId: copy.worker.turnId,
          revision: copy.worker.revision, promptMessageId: copy.worker.promptMessageId, terminalMessageId: copy.worker.terminalMessageId } };
      const result = this.atomic(() => {
        const binding = this.binding(input);
        const old = this.db.select().from(goalReviewerAdmissions).where(and(
          eq(goalReviewerAdmissions.runId, input.runId), eq(goalReviewerAdmissions.rootSessionId, input.rootSessionId),
          eq(goalReviewerAdmissions.goalVersion, binding.goal.sourceVersion),
          eq(goalReviewerAdmissions.sourceFingerprint, binding.goal.sourceFingerprint),
          eq(goalReviewerAdmissions.workerFingerprint, binding.workerFingerprint),
        )).get();
        if (old) {
          if (old.descriptorJson !== descriptor(binding.json, old) || old.descriptorSha256 !== hash(old.descriptorJson)
            || !this.childCurrent(old, binding)) unavailable();
          return { inserted: false, admission: old };
        }
        const id = randomUUID();
        const childSessionId = `goal-reviewer-${id}`;
        const plannedTurnId = `goal-review-${id}`;
        const now = new Date();
        // Same connection/transaction, child first to satisfy FK. No early event.
        sessionTreeStopAdmission(this.db).runIfAdmitted(input.rootSessionId, () => this.db.insert(sessions).values({
          id: childSessionId, title: 'Execution reviewer', kind: 'subagent', personaId: binding.worker.personaId,
          parentSessionId: input.rootSessionId, parentTurnId: binding.worker.parentTurnId,
          parentToolCallId: `goal-reviewer:${id}`, projectId: binding.root.projectId,
          executionProfileId: binding.profile.id, createdAt: now, updatedAt: now,
          runtimeContext: { runtimeKind: 'subagent', architectureContext: { architectureRunId: input.runId,
            roleSlotId: 'execution-reviewer', roleSlotType: 'judge', roleLabel: 'Execution reviewer',
            sessionSurface: 'conversation-branch', conversationVisibility: 'visible' } },
        }).run());
        const json = descriptor(binding.json, { childSessionId, plannedTurnId, createdAt: now.getTime() });
        const admission: Admission = { admissionId: id, runId: input.runId, rootSessionId: input.rootSessionId,
          goalVersion: binding.goal.sourceVersion, sourceFingerprint: binding.goal.sourceFingerprint,
          workerFingerprint: binding.workerFingerprint, descriptorJson: json, descriptorSha256: hash(json),
          childSessionId, plannedTurnId, state: 'admitted', revision: 0, createdAt: now.getTime() };
        this.db.insert(goalReviewerAdmissions).values(admission).run();
        return { inserted: true, admission };
      });
      if (!result.inserted) return { kind: 'existing', admission: result.admission };
      const pin = structuredClone(result.admission);
      let consumed = false;
      return { kind: 'inserted', admission: structuredClone(pin), claimStart: () => {
        if (consumed) return false;
        consumed = true;
        try {
          return this.atomic(() => {
            const current = this.binding(input);
            if (descriptor(current.json, pin) !== pin.descriptorJson || hash(pin.descriptorJson) !== pin.descriptorSha256
              || !this.childCurrent(pin, current)) return false;
            return sessionTreeStopAdmission(this.db).runIfAdmitted(input.rootSessionId, () =>
              this.db.update(goalReviewerAdmissions).set({ state: 'started', revision: 1 }).where(and(
              eq(goalReviewerAdmissions.admissionId, pin.admissionId), eq(goalReviewerAdmissions.revision, 0),
              eq(goalReviewerAdmissions.state, 'admitted'), eq(goalReviewerAdmissions.descriptorSha256, pin.descriptorSha256),
              eq(goalReviewerAdmissions.descriptorJson, pin.descriptorJson),
            )).run()).changes === 1;
          });
        } catch { return false; }
      } };
    } catch { return { kind: 'unavailable' }; }
  }

  private childCurrent(row: Admission, binding: ReturnType<ArchitectureGoalReviewerRepository['binding']>): boolean {
    const child = this.db.select().from(sessions).where(eq(sessions.id, row.childSessionId)).get();
    return !!child && child.kind === 'subagent' && child.parentSessionId === row.rootSessionId
      && child.executionProfileId === binding.profile.id && child.projectId === binding.root.projectId
      && child.personaId === binding.worker.personaId && child.parentTurnId === binding.worker.parentTurnId
      && child.parentToolCallId === `goal-reviewer:${row.admissionId}` && child.createdAt.getTime() === row.createdAt;
  }

  cancelAdmitted(admissionId: string, descriptorSha256: string): boolean {
    try {
      return this.atomic(() => this.db.update(goalReviewerAdmissions).set({ state: 'cancelled', revision: 1 }).where(and(
        eq(goalReviewerAdmissions.admissionId, admissionId), eq(goalReviewerAdmissions.descriptorSha256, descriptorSha256),
        eq(goalReviewerAdmissions.state, 'admitted'), eq(goalReviewerAdmissions.revision, 0),
      )).run().changes === 1);
    } catch { return false; }
  }

  private binding(input: ReviewerAdmissionInput) {
    if (!input.runId || !input.rootSessionId || !Number.isSafeInteger(input.expectedStateRevision)
      || input.expectedStateRevision < 1 || !Number.isSafeInteger(input.worker.revision) || input.worker.revision < 1
      || !/^[a-f0-9]{64}$/.test(input.reviewerPromptFingerprint)) unavailable();
    const goal = this.db.select().from(architectureGoalStates).where(eq(architectureGoalStates.runId, input.runId)).get();
    const root = this.db.select().from(sessions).where(eq(sessions.id, input.rootSessionId)).get();
    const worker = this.db.select().from(sessions).where(eq(sessions.id, input.worker.sessionId)).get();
    const run = this.db.select().from(chatRuns).where(eq(chatRuns.id, input.worker.chatRunId)).get();
    if (!goal || goal.rootSessionId !== input.rootSessionId || goal.stateRevision !== input.expectedStateRevision
      || !Number.isSafeInteger(goal.sourceVersion) || goal.sourceVersion < 1
      || goal.projectionStatus !== 'accepted' || !goal.goalFingerprint || !root || !worker || !run
      || worker.kind !== 'subagent' || worker.parentSessionId !== root.id || worker.projectId !== root.projectId
      || worker.executionProfileId !== root.executionProfileId
      || worker.runtimeContext?.architectureContext?.['architectureRunId'] !== input.runId
      || run.sessionId !== worker.id || run.turnId !== input.worker.turnId || run.revision !== input.worker.revision
      || run.status !== 'completed' || run.phase !== 'completed' || run.completedAt === null
      || run.outcome?.messageId !== input.worker.terminalMessageId || run.executionProfileId !== worker.executionProfileId) unavailable();
    const profile = this.db.select().from(executionProfiles).where(eq(executionProfiles.id, worker.executionProfileId)).get();
    const project = this.db.select().from(projects).where(eq(projects.id, root.projectId)).get();
    const prompt = this.db.select().from(messages).where(eq(messages.id, input.worker.promptMessageId)).get();
    const terminal = this.db.select().from(messages).where(eq(messages.id, input.worker.terminalMessageId)).get();
    const turns = this.db.select({ id: chatRuns.id }).from(chatRuns).where(and(
      eq(chatRuns.sessionId, worker.id), eq(chatRuns.turnId, run.turnId))).all();
    if (!profile?.enabled || profile.kind !== 'devin-cli-acp' || !profile.model.trim() || profile.model !== run.model
      || !project?.path || project.kind !== 'workspace' || turns.length !== 1 || !prompt || !terminal
      || prompt.role !== 'user' || prompt.sessionId !== worker.id || prompt.turnId !== run.turnId || prompt.promptMessageId !== prompt.id
      || terminal.role !== 'assistant' || terminal.sessionId !== worker.id || terminal.turnId !== run.turnId
      || terminal.promptMessageId !== prompt.id || !terminal.content.trim()) unavailable();
    const policy = this.db.select().from(appSettings).where(eq(appSettings.key, 'devin.cli.native-tools')).get();
    // Pin actual stored policy, including absence. Enforcement is a separate
    // runtime contract: this unwired repository never asserts deny-all execution.
    const workerFingerprint = hash(JSON.stringify(input.worker));
    // Metadata tombstone only. Never duplicate human/worker bodies or raw context
    // in append-only storage; fresh bodies are read and hashed on every comparison.
    const scope = (session: typeof sessions.$inferSelect) => ({ id: session.id, kind: session.kind,
      parentSessionId: session.parentSessionId, parentTurnId: session.parentTurnId, parentToolCallId: session.parentToolCallId,
      projectId: session.projectId, executionProfileId: session.executionProfileId, personaId: session.personaId,
      createdAt: session.createdAt.getTime(), contextSha256: hash(JSON.stringify(session.runtimeContext)) });
    const json = JSON.stringify({ version: 1, input,
      goal: { runId: goal.runId, rootSessionId: goal.rootSessionId, stateRevision: goal.stateRevision,
        sourceVersion: goal.sourceVersion, sourceFingerprint: goal.sourceFingerprint, goalFingerprint: goal.goalFingerprint,
        packetSha256: hash(goal.packetJson), evidenceSha256: hash(JSON.stringify(goal.evidenceInventoryJson)),
        authorizationSha256: hash(JSON.stringify(goal.completionAuthorizationJson)) },
      root: scope(root), worker: scope(worker),
      run: { id: run.id, revision: run.revision, provider: run.provider, model: run.model,
        executionProfileId: run.executionProfileId, completedAt: run.completedAt.getTime(),
        outcomeSha256: hash(JSON.stringify(run.outcome)) },
      profile: { id: profile.id, kind: profile.kind, provider: profile.provider, model: profile.model,
        authProfileId: profile.authProfileId, approvalMode: profile.approvalMode, enabled: profile.enabled,
        reasoningEffort: profile.reasoningEffort, capabilitiesVersion: profile.capabilitiesVersion },
      project: { id: project.id, kind: project.kind, path: project.path, normalizedPath: project.normalizedPath },
      promptSha256: hash(JSON.stringify(prompt)), terminalSha256: hash(JSON.stringify(terminal)),
      nativePolicySha256: hash(JSON.stringify(policy ? { present: true, value: policy.value } : { present: false })),
      reviewerPolicy: 'no-tools-no-mcp-no-native-v1' });
    return { json, goal, root, worker, profile, workerFingerprint };
  }

  private atomic<T>(operation: () => T): T {
    // Refuse an outer transaction rather than returning winner authority before
    // its commit. BEGIN failure must never roll back somebody else's transaction.
    this.db.run(sql`BEGIN IMMEDIATE`);
    try {
      const result = operation();
      this.db.run(sql`COMMIT`);
      return result;
    } catch {
      this.db.run(sql`ROLLBACK`);
      return unavailable();
    }
  }
}
