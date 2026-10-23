CREATE TABLE IF NOT EXISTS `architecture_goal_states` (
  `run_id` text PRIMARY KEY NOT NULL,
  `root_session_id` text NOT NULL,
  `state_revision` integer NOT NULL CHECK (`state_revision` >= 1),
  `source_version` integer NOT NULL CHECK (`source_version` >= 1),
  `projection_status` text NOT NULL CHECK (`projection_status` IN ('pending', 'accepted')),
  `source_fingerprint` text NOT NULL,
  `goal_fingerprint` text,
  `packet_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK ((`projection_status` = 'pending' AND `goal_fingerprint` IS NULL)
    OR (`projection_status` = 'accepted' AND `goal_fingerprint` IS NOT NULL))
);
