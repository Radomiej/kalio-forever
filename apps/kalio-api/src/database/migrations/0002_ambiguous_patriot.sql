CREATE TABLE `agent_iterations` (
	`id` text PRIMARY KEY NOT NULL,
	`loop_id` text NOT NULL,
	`task_id` text,
	`iteration_number` integer NOT NULL,
	`action` text NOT NULL,
	`prompt_used` text DEFAULT '' NOT NULL,
	`result_summary` text DEFAULT '' NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`loop_id`) REFERENCES `agent_loops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_loops` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`persona_id` text NOT NULL,
	`system_prompt` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`config` text NOT NULL,
	`current_task_id` text,
	`chat_session_id` text,
	`iteration_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`loop_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_summary` text,
	`order_index` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`loop_id`) REFERENCES `agent_loops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`prompt` text NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`transport` text DEFAULT 'http' NOT NULL,
	`url` text,
	`command` text,
	`args` text,
	`env_vars` text,
	`headers` text,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`tool_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_mcp_servers`("id", "name", "transport", "url", "enabled", "status", "created_at") SELECT "id", "name", 'http', "url", 1, "status", "created_at" FROM `mcp_servers`;--> statement-breakpoint
DROP TABLE `mcp_servers`;--> statement-breakpoint
ALTER TABLE `__new_mcp_servers` RENAME TO `mcp_servers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;