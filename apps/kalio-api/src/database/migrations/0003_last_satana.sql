CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `workspaces` (`id`, `name`, `created_at`, `updated_at`) VALUES ('default', 'Default Workspace', 0, 0);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `workspace_id` text NOT NULL DEFAULT 'default';