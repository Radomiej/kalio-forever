import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Dispatcher-owned, insert-only receipts. Payload bytes remain exact TEXT;
 * the Chat store validates version, hash and linked durable evidence. */
export const hostDispatchReceipts = sqliteTable('host_dispatch_receipts', {
  runId: text('run_id').notNull(),
  sessionId: text('session_id').notNull(),
  turnId: text('turn_id').notNull(),
  promptMessageId: text('prompt_message_id').notNull(),
  callId: text('call_id').notNull(),
  recordJson: text('record_json').notNull(),
  recordSha256: text('record_sha256').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, table => [primaryKey({ columns: [table.runId, table.sessionId, table.turnId,
  table.promptMessageId, table.callId] })]);
