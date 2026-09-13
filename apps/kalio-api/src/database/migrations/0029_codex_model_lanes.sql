INSERT OR IGNORE INTO `execution_profiles`
  (`id`, `name`, `kind`, `provider`, `model`, `auth_profile_id`, `reasoning_effort`, `approval_mode`, `enabled`, `capabilities_version`, `created_at`, `updated_at`)
VALUES
  ('codex-luna', 'Codex ChatGPT - Luna 5.6', 'codex-app-server', NULL, 'gpt-5.6-luna', 'chatgpt-default', 'max', 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000),
  ('codex-sol', 'Codex ChatGPT - Sol 5.6', 'codex-app-server', NULL, 'gpt-5.6-sol', 'chatgpt-default', 'max', 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000),
  ('codex-terra', 'Codex ChatGPT - Terra 5.6', 'codex-app-server', NULL, 'gpt-5.6-terra', 'chatgpt-default', 'max', 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000),
  ('codex-spark', 'Codex ChatGPT - Spark 5.3', 'codex-app-server', NULL, 'gpt-5.3-codex-spark', 'chatgpt-default', 'xhigh', 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000),
  ('codex-mini', 'Codex ChatGPT - Mini 5.4', 'codex-app-server', NULL, 'gpt-5.4-mini', 'chatgpt-default', 'xhigh', 'kalio_strict', 1, '1', unixepoch() * 1000, unixepoch() * 1000);
