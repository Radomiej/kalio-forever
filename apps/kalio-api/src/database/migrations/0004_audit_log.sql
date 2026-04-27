CREATE TABLE IF NOT EXISTS `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`data` text,
	`duration_ms` integer,
	`created_at` integer NOT NULL
);
