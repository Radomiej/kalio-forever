CREATE TABLE `execution_profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `kind` text NOT NULL,
  `provider` text,
  `model` text NOT NULL,
  `auth_profile_id` text,
  `reasoning_effort` text,
  `approval_mode` text NOT NULL DEFAULT 'codex_guard',
  `enabled` integer NOT NULL DEFAULT true,
  `capabilities_version` text NOT NULL DEFAULT '1',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `execution_profiles`
  (`id`, `name`, `kind`, `provider`, `model`, `auth_profile_id`, `approval_mode`, `enabled`, `capabilities_version`, `created_at`, `updated_at`)
VALUES
  ('local-direct-default', 'Local direct LLM', 'direct-llm', NULL, '', NULL, 'codex_guard', 1, '1', unixepoch() * 1000, unixepoch() * 1000),
  ('codex-guard', 'Codex Guard', 'codex-app-server', NULL, 'gpt-5.4', 'chatgpt-default', 'codex_guard', 1, '1', unixepoch() * 1000, unixepoch() * 1000),
  ('codex-strict', 'Codex Strict', 'codex-app-server', NULL, 'gpt-5.4', 'chatgpt-default', 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000);
--> statement-breakpoint
ALTER TABLE `personas` ADD COLUMN `execution_profile_id` text NOT NULL DEFAULT 'local-direct-default';
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `default_execution_profile_id` text NOT NULL DEFAULT 'local-direct-default';
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `execution_profile_id` text NOT NULL DEFAULT 'local-direct-default';
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `external_thread_id` text;
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `toolset_fingerprint` text;
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `policy_fingerprint` text;
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `runtime_binding_version` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `chat_runs` ADD COLUMN `runtime_kind` text;
--> statement-breakpoint
ALTER TABLE `chat_runs` ADD COLUMN `execution_profile_id` text;
--> statement-breakpoint
ALTER TABLE `chat_runs` ADD COLUMN `external_thread_id` text;
--> statement-breakpoint
ALTER TABLE `chat_runs` ADD COLUMN `external_turn_id` text;
--> statement-breakpoint
ALTER TABLE `chat_runs` ADD COLUMN `process_epoch` text;
--> statement-breakpoint
CREATE INDEX `sessions_execution_profile_id_idx` ON `sessions` (`execution_profile_id`);
--> statement-breakpoint
CREATE INDEX `chat_runs_execution_profile_id_idx` ON `chat_runs` (`execution_profile_id`);
