-- Custom SQL migration file, put your code below! --
ALTER TABLE `agent_flow_runs` ADD COLUMN `parent_tool_call_id` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `turn_id` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `prompt_message_id` text;
