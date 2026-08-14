ALTER TABLE `chat_runs` ADD `queue_idempotency_key` text;
--> statement-breakpoint
ALTER TABLE `chat_runs` ADD `queued_payload` text;
--> statement-breakpoint
ALTER TABLE `chat_runs` ADD `queued_at` integer;
--> statement-breakpoint
ALTER TABLE `chat_runs` ADD `queue_claimed_at` integer;
--> statement-breakpoint
ALTER TABLE `chat_runs` ADD `queue_cancelled_at` integer;
--> statement-breakpoint
CREATE INDEX `chat_runs_session_status_queued_at_idx` ON `chat_runs` (`session_id`,`status`,`queued_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_runs_session_queue_idempotency_key_idx` ON `chat_runs` (`session_id`,`queue_idempotency_key`);
