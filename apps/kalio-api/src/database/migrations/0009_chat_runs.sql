CREATE TABLE IF NOT EXISTS `chat_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `turn_id` text NOT NULL,
  `phase` text NOT NULL,
  `status` text NOT NULL,
  `provider` text,
  `model` text,
  `retry_count` integer NOT NULL DEFAULT 0,
  `safe_resume` integer NOT NULL DEFAULT 0,
  `error_code` text,
  `error_message` text,
  `started_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `last_heartbeat_at` integer NOT NULL,
  `completed_at` integer
);
