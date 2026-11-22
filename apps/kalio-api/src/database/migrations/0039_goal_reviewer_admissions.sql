CREATE TABLE `goal_reviewer_admissions` (
  `admission_id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `root_session_id` text NOT NULL,
  `goal_version` integer NOT NULL CHECK (typeof(`goal_version`) = 'integer' AND `goal_version` >= 1),
  `source_fingerprint` text NOT NULL,
  `worker_fingerprint` text NOT NULL,
  `descriptor_json` text NOT NULL,
  `descriptor_sha256` text NOT NULL,
  `child_session_id` text NOT NULL,
  `planned_turn_id` text NOT NULL,
  `state` text DEFAULT 'admitted' NOT NULL,
  `revision` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  CHECK ((`state` = 'admitted' AND `revision` = 0) OR (`state` IN ('started', 'cancelled') AND `revision` = 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goal_reviewer_logical_identity` ON `goal_reviewer_admissions`
(`run_id`, `root_session_id`, `goal_version`, `source_fingerprint`, `worker_fingerprint`);
--> statement-breakpoint
CREATE UNIQUE INDEX `goal_reviewer_child` ON `goal_reviewer_admissions` (`child_session_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `goal_reviewer_turn` ON `goal_reviewer_admissions` (`planned_turn_id`);
--> statement-breakpoint
CREATE TRIGGER `goal_reviewer_no_replace` BEFORE INSERT ON `goal_reviewer_admissions`
WHEN EXISTS (SELECT 1 FROM `goal_reviewer_admissions` WHERE `admission_id` = NEW.`admission_id`
  OR `child_session_id` = NEW.`child_session_id` OR `planned_turn_id` = NEW.`planned_turn_id`
  OR (`run_id` = NEW.`run_id` AND `root_session_id` = NEW.`root_session_id`
    AND `goal_version` = NEW.`goal_version` AND `source_fingerprint` = NEW.`source_fingerprint`
    AND `worker_fingerprint` = NEW.`worker_fingerprint`))
BEGIN SELECT RAISE(ABORT, 'REVIEWER_ADMISSION_DUPLICATE'); END;
--> statement-breakpoint
CREATE TRIGGER `goal_reviewer_initial_state` BEFORE INSERT ON `goal_reviewer_admissions`
WHEN NEW.`state` != 'admitted' OR NEW.`revision` != 0
BEGIN SELECT RAISE(ABORT, 'REVIEWER_ADMISSION_INITIAL_STATE'); END;
--> statement-breakpoint
CREATE TRIGGER `goal_reviewer_transition` BEFORE UPDATE ON `goal_reviewer_admissions`
WHEN OLD.`state` != 'admitted' OR NEW.`state` NOT IN ('started', 'cancelled')
  OR NEW.`revision` != OLD.`revision` + 1
  OR NEW.`admission_id` IS NOT OLD.`admission_id` OR NEW.`run_id` IS NOT OLD.`run_id`
  OR NEW.`root_session_id` IS NOT OLD.`root_session_id` OR NEW.`goal_version` IS NOT OLD.`goal_version`
  OR NEW.`source_fingerprint` IS NOT OLD.`source_fingerprint` OR NEW.`worker_fingerprint` IS NOT OLD.`worker_fingerprint`
  OR NEW.`descriptor_json` IS NOT OLD.`descriptor_json` OR NEW.`descriptor_sha256` IS NOT OLD.`descriptor_sha256`
  OR NEW.`child_session_id` IS NOT OLD.`child_session_id` OR NEW.`planned_turn_id` IS NOT OLD.`planned_turn_id`
  OR NEW.`created_at` IS NOT OLD.`created_at`
BEGIN SELECT RAISE(ABORT, 'REVIEWER_ADMISSION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `goal_reviewer_no_delete` BEFORE DELETE ON `goal_reviewer_admissions`
BEGIN SELECT RAISE(ABORT, 'REVIEWER_ADMISSION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `goal_reviewer_child_no_recreate` BEFORE INSERT ON `sessions`
WHEN EXISTS (SELECT 1 FROM `goal_reviewer_admissions` WHERE `child_session_id` = NEW.`id`)
BEGIN SELECT RAISE(ABORT, 'REVIEWER_CHILD_ID_RESERVED'); END;
--> statement-breakpoint
CREATE TRIGGER `goal_reviewer_child_no_rekey` BEFORE UPDATE OF `id` ON `sessions`
WHEN NEW.`id` IS NOT OLD.`id` AND EXISTS (SELECT 1 FROM `goal_reviewer_admissions`
  WHERE `child_session_id` = OLD.`id` OR `child_session_id` = NEW.`id`)
BEGIN SELECT RAISE(ABORT, 'REVIEWER_CHILD_ID_RESERVED'); END;
