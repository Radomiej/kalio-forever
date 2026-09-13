INSERT OR IGNORE INTO `execution_profiles`
  (`id`, `name`, `kind`, `provider`, `model`, `auth_profile_id`, `reasoning_effort`, `approval_mode`, `enabled`, `capabilities_version`, `created_at`, `updated_at`)
VALUES
  ('claude-local', 'Claude Code - Local Login', 'claude-agent-sdk', NULL, 'claude-sonnet-4-6', NULL, 'high', 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000);
