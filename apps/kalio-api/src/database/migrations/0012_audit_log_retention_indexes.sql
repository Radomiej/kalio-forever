CREATE INDEX IF NOT EXISTS `audit_log_created_at_idx` ON `audit_log` (`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_log_session_created_at_idx` ON `audit_log` (`session_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_log_type_created_at_idx` ON `audit_log` (`type`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_log_archive_created_at_idx` ON `audit_log_archive` (`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_log_archive_session_created_at_idx` ON `audit_log_archive` (`session_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_log_archive_type_created_at_idx` ON `audit_log_archive` (`type`, `created_at`);
