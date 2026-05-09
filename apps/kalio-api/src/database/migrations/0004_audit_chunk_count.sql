-- Clears existing audit_log rows and adds chunk_count column.
-- Existing rows are worthless without chunkCount and grow unbounded, so we truncate here.
DELETE FROM `audit_log`;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `chunk_count` integer;
