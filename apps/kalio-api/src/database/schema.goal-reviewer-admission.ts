import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** One attempt per goal/worker snapshot. Tombstones do not prevent chat deletion. */
export const goalReviewerAdmissions = sqliteTable('goal_reviewer_admissions', {
  admissionId: text('admission_id').primaryKey().notNull(),
  runId: text('run_id').notNull(),
  rootSessionId: text('root_session_id').notNull(),
  goalVersion: integer('goal_version').notNull(),
  sourceFingerprint: text('source_fingerprint').notNull(),
  workerFingerprint: text('worker_fingerprint').notNull(),
  descriptorJson: text('descriptor_json').notNull(),
  descriptorSha256: text('descriptor_sha256').notNull(),
  childSessionId: text('child_session_id').notNull(),
  plannedTurnId: text('planned_turn_id').notNull(),
  state: text('state', { enum: ['admitted', 'started', 'cancelled'] }).notNull().default('admitted'),
  revision: integer('revision').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, table => [
  uniqueIndex('goal_reviewer_logical_identity').on(table.runId, table.rootSessionId, table.goalVersion,
    table.sourceFingerprint, table.workerFingerprint),
  uniqueIndex('goal_reviewer_child').on(table.childSessionId),
  uniqueIndex('goal_reviewer_turn').on(table.plannedTurnId),
  check('goal_reviewer_version', sql`typeof(${table.goalVersion}) = 'integer' AND ${table.goalVersion} >= 1`),
  check('goal_reviewer_state_revision', sql`(${table.state} = 'admitted' AND ${table.revision} = 0)
    OR (${table.state} IN ('started', 'cancelled') AND ${table.revision} = 1)`),
]);
