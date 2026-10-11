CREATE TABLE `host_dispatch_receipts` (
  `run_id` text NOT NULL,
  `session_id` text NOT NULL,
  `turn_id` text NOT NULL,
  `prompt_message_id` text NOT NULL,
  `call_id` text NOT NULL,
  `record_json` text NOT NULL,
  `record_sha256` text NOT NULL,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`run_id`, `session_id`, `turn_id`, `prompt_message_id`, `call_id`)
);
