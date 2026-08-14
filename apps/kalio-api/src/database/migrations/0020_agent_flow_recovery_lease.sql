ALTER TABLE `agent_flow_runs` ADD `revision` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `agent_flow_runs` ADD `lease_owner` text;
--> statement-breakpoint
ALTER TABLE `agent_flow_runs` ADD `lease_expires_at` integer;
--> statement-breakpoint
CREATE INDEX `agent_flow_runs_status_lease_idx` ON `agent_flow_runs` (`status`, `lease_expires_at`);
