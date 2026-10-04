import { sql } from 'drizzle-orm';

/** Admission order is durable; heartbeats must not revive a superseded safe turn. */
export function hasNoNewerAdmittedTurn() {
  return sql`NOT EXISTS (
    SELECT 1 FROM chat_runs AS newer
    WHERE newer.session_id = chat_runs.session_id
      AND newer.turn_id <> chat_runs.turn_id
      AND (newer.queued_at IS NULL OR newer.queue_claimed_at IS NOT NULL)
      AND (
        COALESCE(newer.queue_claimed_at, newer.started_at)
          > COALESCE(chat_runs.queue_claimed_at, chat_runs.started_at)
        OR (
          COALESCE(newer.queue_claimed_at, newer.started_at)
            = COALESCE(chat_runs.queue_claimed_at, chat_runs.started_at)
          AND newer.rowid > chat_runs.rowid
        )
      )
  )`;
}
