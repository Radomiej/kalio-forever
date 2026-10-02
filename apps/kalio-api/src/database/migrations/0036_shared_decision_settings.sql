INSERT OR IGNORE INTO app_settings (key, value, updated_at)
SELECT 'decision.config', json_object('provider', 'openrouter', 'model', 'typesafe/jev-1.13', 'credentialId', value, 'endpoint', ''), unixepoch() * 1000
FROM app_settings WHERE key = 'hitl.jevCredentialId' AND length(trim(value)) > 0;
--> statement-breakpoint
DELETE FROM app_settings WHERE key = 'hitl.jevCredentialId';
