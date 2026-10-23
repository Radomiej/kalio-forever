import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const architectureGoalStates = sqliteTable('architecture_goal_states', {
  runId: text('run_id').primaryKey().notNull(),
  rootSessionId: text('root_session_id').notNull(),
  stateRevision: integer('state_revision').notNull(),
  sourceVersion: integer('source_version').notNull(),
  projectionStatus: text('projection_status').$type<'pending' | 'accepted'>().notNull(),
  sourceFingerprint: text('source_fingerprint').notNull(),
  goalFingerprint: text('goal_fingerprint'),
  packetJson: text('packet_json').notNull(),
  evidenceInventoryJson: text('evidence_inventory_json'),
  completionAuthorizationJson: text('completion_authorization_json'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  check('architecture_goal_revision_positive', sql`${table.stateRevision} >= 1`),
  check('architecture_goal_source_version_positive', sql`${table.sourceVersion} >= 1`),
  check('architecture_goal_projection_status', sql`${table.projectionStatus} IN ('pending', 'accepted')`),
  check('architecture_goal_fingerprint_status', sql`(${table.projectionStatus} = 'pending' AND ${table.goalFingerprint} IS NULL) OR (${table.projectionStatus} = 'accepted' AND ${table.goalFingerprint} IS NOT NULL)`),
]);
