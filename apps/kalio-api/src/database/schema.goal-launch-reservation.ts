import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { chatRuns } from './schema';

/** Operational identity fence, not audit telemetry or launch authorization.
 * No cleanup API: occupied mappings survive Stop, failure and audit retention. */
export const goalLaunchReservations = sqliteTable('goal_launch_reservations', {
  parentRunId: text('parent_run_id').notNull().references(() => chatRuns.id, { onDelete: 'restrict' }),
  parentSessionId: text('parent_session_id').notNull(),
  parentTurnId: text('parent_turn_id').notNull(),
  promptMessageId: text('prompt_message_id').notNull(),
  callId: text('call_id').notNull(),
  childRunId: text('child_run_id').notNull(),
  rootSessionId: text('root_session_id').notNull(),
  authorizationId: text('authorization_id').notNull(),
  admissionId: text('admission_id').notNull(),
  descriptorVersion: integer('descriptor_version').notNull(),
  descriptorJson: text('descriptor_json').notNull(),
  descriptorSha256: text('descriptor_sha256').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [primaryKey({ columns: [table.parentRunId, table.parentSessionId, table.parentTurnId,
  table.promptMessageId, table.callId] })]);
