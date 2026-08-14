CREATE TABLE `hitl_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `session_id` text NOT NULL,
  `turn_id` text,
  `run_id` text,
  `tool_call_id` text,
  `payload` text NOT NULL,
  `continuation` text,
  `outcome` text,
  `revision` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `hitl_requests_session_status_idx` ON `hitl_requests` (`session_id`, `status`);
--> statement-breakpoint
CREATE INDEX `hitl_requests_run_status_idx` ON `hitl_requests` (`run_id`, `status`);
