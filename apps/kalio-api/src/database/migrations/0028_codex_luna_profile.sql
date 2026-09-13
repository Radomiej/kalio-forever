INSERT OR IGNORE INTO `execution_profiles`
  (`id`, `name`, `kind`, `provider`, `model`, `auth_profile_id`, `reasoning_effort`, `approval_mode`, `enabled`, `capabilities_version`, `created_at`, `updated_at`)
VALUES
  ('codex-luna', 'Codex ChatGPT - Luna 5.6', 'codex-app-server', NULL, 'gpt-5.6-luna', 'chatgpt-default', 'max', 'codex_guard', 1, '1', unixepoch() * 1000, unixepoch() * 1000);
