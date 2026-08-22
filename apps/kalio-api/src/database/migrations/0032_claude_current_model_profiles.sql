INSERT OR IGNORE INTO `execution_profiles`
  (`id`, `name`, `kind`, `provider`, `model`, `auth_profile_id`, `reasoning_effort`, `approval_mode`, `enabled`, `capabilities_version`, `created_at`, `updated_at`)
VALUES
  ('claude-fable-5', 'Claude Code - Fable 5', 'claude-agent-sdk', NULL, 'claude-fable-5', NULL, 'high', 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000),
  ('claude-opus-5', 'Claude Code - Opus 5', 'claude-agent-sdk', NULL, 'claude-opus-5', NULL, 'high', 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000),
  ('claude-sonnet-5', 'Claude Code - Sonnet 5', 'claude-agent-sdk', NULL, 'claude-sonnet-5', NULL, 'high', 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000),
  ('claude-haiku-4-5', 'Claude Code - Haiku 4.5', 'claude-agent-sdk', NULL, 'claude-haiku-4-5', NULL, 'high', 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000);
