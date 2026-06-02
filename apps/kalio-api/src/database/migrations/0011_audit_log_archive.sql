CREATE TABLE IF NOT EXISTS `audit_log_archive` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text,
  `type` text NOT NULL,
  `label` text NOT NULL,
  `data` text,
  `duration_ms` integer,
  `chunk_count` integer,
  `created_at` integer NOT NULL,
  `archived_at` integer NOT NULL
);
