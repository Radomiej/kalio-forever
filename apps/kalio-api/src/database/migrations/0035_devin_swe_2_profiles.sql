UPDATE `execution_profiles`
SET `enabled` = 0, `updated_at` = unixepoch() * 1000
WHERE `id` = 'devin-local-swe-1-7';
--> statement-breakpoint

INSERT OR IGNORE INTO `execution_profiles`
  (`id`, `name`, `kind`, `provider`, `model`, `auth_profile_id`, `reasoning_effort`, `approval_mode`, `enabled`, `capabilities_version`, `created_at`, `updated_at`)
VALUES
  ('devin-local-swe-2-high', 'Devin · SWE-2 High', 'devin-cli-acp', NULL, 'swe-2-high', NULL, NULL, 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000),
  ('devin-local-swe-2-medium', 'Devin · SWE-2 Medium', 'devin-cli-acp', NULL, 'swe-2-medium', NULL, NULL, 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000),
  ('devin-local-swe-2-max', 'Devin · SWE-2 Max', 'devin-cli-acp', NULL, 'swe-2-max', NULL, NULL, 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000);
