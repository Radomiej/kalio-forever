CREATE TABLE IF NOT EXISTS `agent_flow_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `parent_session_id` text NOT NULL,
  `child_session_id` text NOT NULL,
  `open_chat_session_id` text,
  `open_graph_run_id` text,
  `flow_definition_id` text NOT NULL,
  `status` text NOT NULL,
  `start_mode` text NOT NULL,
  `return_mode` text NOT NULL,
  `waiting_for_node_id` text,
  `active_node_ids` text,
  `completed_node_ids` text,
  `active_phases` text,
  `completed_phases` text,
  `node_visit_counts` text,
  `max_iterations` integer,
  `return_to_orchestrator_count` integer,
  `checkpoint` text,
  `result` text,
  `summary` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `finished_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `agent_flow_events` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `sequence` integer NOT NULL,
  `type` text NOT NULL,
  `status` text,
  `message` text NOT NULL,
  `event` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `agent_flow_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_flow_runs_parent_updated_at_idx` ON `agent_flow_runs` (`parent_session_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_flow_runs_status_updated_at_idx` ON `agent_flow_runs` (`status`, `updated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_flow_events_run_sequence_idx` ON `agent_flow_events` (`run_id`, `sequence`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_flow_events_run_created_at_idx` ON `agent_flow_events` (`run_id`, `created_at`);
