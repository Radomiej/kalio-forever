CREATE TABLE `goal_launch_reservations` (
  `parent_run_id` text NOT NULL REFERENCES `chat_runs`(`id`) ON DELETE RESTRICT,
  `parent_session_id` text NOT NULL,
  `parent_turn_id` text NOT NULL,
  `prompt_message_id` text NOT NULL,
  `call_id` text NOT NULL,
  `child_run_id` text NOT NULL,
  `root_session_id` text NOT NULL,
  `authorization_id` text NOT NULL,
  `admission_id` text NOT NULL,
  `descriptor_version` integer NOT NULL CHECK (`descriptor_version` = 1),
  `descriptor_json` text NOT NULL,
  `descriptor_sha256` text NOT NULL,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`parent_run_id`, `parent_session_id`, `parent_turn_id`, `prompt_message_id`, `call_id`)
);
--> statement-breakpoint
CREATE TRIGGER `goal_launch_reservations_no_replace`
BEFORE INSERT ON `goal_launch_reservations`
WHEN EXISTS (SELECT 1 FROM `goal_launch_reservations`
  WHERE `parent_run_id` = NEW.`parent_run_id`
    AND `parent_session_id` = NEW.`parent_session_id`
    AND `parent_turn_id` = NEW.`parent_turn_id`
    AND `prompt_message_id` = NEW.`prompt_message_id`
    AND `call_id` = NEW.`call_id`)
BEGIN SELECT RAISE(ABORT, 'GOAL_LAUNCH_RESERVATION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `goal_launch_reservations_no_update`
BEFORE UPDATE ON `goal_launch_reservations`
BEGIN SELECT RAISE(ABORT, 'GOAL_LAUNCH_RESERVATION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `goal_launch_reservations_no_delete`
BEFORE DELETE ON `goal_launch_reservations`
BEGIN SELECT RAISE(ABORT, 'GOAL_LAUNCH_RESERVATION_IMMUTABLE'); END;
