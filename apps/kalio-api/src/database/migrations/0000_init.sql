-- Kalio database schema -- single consolidated initialisation.
-- Replaces all previous incremental migrations.
--
-- Notable decisions:
--   - No "workspaces" table / "workspace_id" column: session is the unit of
--     isolation in Kalio (see AGENTS.md). The concept was removed deliberately.
--   - "allowed_paths" table added (was missing from previous migrations).
--   - "messages" includes "thinking" and "attachments" columns from day one.

CREATE TABLE `credentials` (
`id` text PRIMARY KEY NOT NULL,
`name` text NOT NULL,
`provider` text NOT NULL,
`api_key` text NOT NULL,
`base_url` text,
`model` text,
`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_servers` (
`id` text PRIMARY KEY NOT NULL,
`name` text NOT NULL,
`transport` text NOT NULL DEFAULT 'http',
`url` text,
`command` text,
`args` text,
`env_vars` text,
`headers` text,
`enabled` integer NOT NULL DEFAULT true,
`status` text NOT NULL DEFAULT 'disconnected',
`tool_count` integer NOT NULL DEFAULT 0,
`last_error` text,
`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skills` (
`id` text PRIMARY KEY NOT NULL,
`name` text NOT NULL,
`description` text NOT NULL DEFAULT '',
`prompt` text NOT NULL,
`source` text NOT NULL DEFAULT 'user',
`created_at` integer NOT NULL,
`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
`key` text PRIMARY KEY NOT NULL,
`value` text NOT NULL,
`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `allowed_paths` (
`id` text PRIMARY KEY NOT NULL,
`path` text NOT NULL,
`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
`id` text PRIMARY KEY NOT NULL,
`session_id` text,
`type` text NOT NULL,
`label` text NOT NULL,
`data` text,
`duration_ms` integer,
`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `personas` (
`id` text PRIMARY KEY NOT NULL,
`name` text NOT NULL,
`system_prompt` text NOT NULL DEFAULT '',
`model` text NOT NULL,
`skills` text NOT NULL DEFAULT '[]',
`created_at` integer NOT NULL,
`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
`id` text PRIMARY KEY NOT NULL,
`persona_id` text NOT NULL,
`title` text NOT NULL DEFAULT '',
`created_at` integer NOT NULL,
`updated_at` integer NOT NULL,
FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `messages` (
`id` text PRIMARY KEY NOT NULL,
`session_id` text NOT NULL,
`role` text NOT NULL,
`content` text NOT NULL,
`thinking` text,
`tool_calls` text,
`tool_call_id` text,
`attachments` text,
`created_at` integer NOT NULL,
FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `persona_kv` (
`id` text PRIMARY KEY NOT NULL,
`persona_id` text NOT NULL,
`key` text NOT NULL,
`value` text NOT NULL,
`updated_at` integer NOT NULL,
FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_loops` (
`id` text PRIMARY KEY NOT NULL,
`name` text NOT NULL,
`persona_id` text NOT NULL,
`system_prompt` text NOT NULL DEFAULT '',
`status` text NOT NULL DEFAULT 'idle',
`config` text NOT NULL,
`current_task_id` text,
`chat_session_id` text,
`iteration_count` integer NOT NULL DEFAULT 0,
`created_at` integer NOT NULL,
`updated_at` integer NOT NULL,
FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_tasks` (
`id` text PRIMARY KEY NOT NULL,
`loop_id` text NOT NULL,
`title` text NOT NULL,
`description` text NOT NULL DEFAULT '',
`priority` integer NOT NULL DEFAULT 0,
`status` text NOT NULL DEFAULT 'pending',
`result_summary` text,
`order_index` integer NOT NULL DEFAULT 0,
`created_at` integer NOT NULL,
`updated_at` integer NOT NULL,
FOREIGN KEY (`loop_id`) REFERENCES `agent_loops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_iterations` (
`id` text PRIMARY KEY NOT NULL,
`loop_id` text NOT NULL,
`task_id` text,
`iteration_number` integer NOT NULL,
`action` text NOT NULL,
`prompt_used` text NOT NULL DEFAULT '',
`result_summary` text NOT NULL DEFAULT '',
`duration_ms` integer NOT NULL DEFAULT 0,
`created_at` integer NOT NULL,
FOREIGN KEY (`loop_id`) REFERENCES `agent_loops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `raapp_pending_approvals` (
`id` text PRIMARY KEY NOT NULL,
`session_id` text NOT NULL,
`tool_call_id` text NOT NULL,
`system` text NOT NULL,
`args` text NOT NULL,
`output_path` text,
`display_label` text NOT NULL,
`status` text NOT NULL DEFAULT 'pending',
`result` text,
`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `raapp_pending_approvals_session_id_idx` ON `raapp_pending_approvals` (`session_id`);
--> statement-breakpoint
CREATE INDEX `raapp_pending_approvals_status_idx` ON `raapp_pending_approvals` (`status`);
