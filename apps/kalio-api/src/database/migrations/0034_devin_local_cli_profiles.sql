INSERT OR IGNORE INTO `execution_profiles`
  (`id`, `name`, `kind`, `provider`, `model`, `auth_profile_id`, `reasoning_effort`, `approval_mode`, `enabled`, `capabilities_version`, `created_at`, `updated_at`)
VALUES
  ('devin-local-glm-5-2', 'Devin · GLM-5.2', 'devin-cli-acp', NULL, 'glm-5-2', NULL, NULL, 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000),
  ('devin-local-swe-1-7', 'Devin · SWE-1.7', 'devin-cli-acp', NULL, 'swe-1-7', NULL, NULL, 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000);
