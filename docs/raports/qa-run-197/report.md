# QA197 — controlled backend deployment, provider preservation

2026-10-04. Backend built and reviewed at HEAD e53b3377, frontend remains QA188. Fixed QA restarted by stack-manager start --backend-port 3316 --frontend-port 5288 --skip-build --runtime direct --data-root C:/Users/Radomiej/AppData/Local/kalio-forever-qa. No force-port kill, reset, token rotation or provider changes. KALIO_INSTALL_PROFILE=qa, KALIO_FORCE_ENV_LLM=0.

Both approved test sessions had null current runs before restart. Spontaneous work in other sessions is not claimed absent. Consistent SQLite backup completed at ignored .tmp/qa-provider-backup/qa-before-197.db. This is a sensitive local backup, not an encrypted provider export feature, and must not be committed.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Provider configuration retained | PASS | credentials, app_settings, execution_profiles row SHA256 unchanged against backup; SQLite integrity_check ok | No decrypted credential use proven by comparison alone |
| New backend actually started | PASS | stack manager exit 0; state backend PID29748/frontend PID17424, started 2026-10-04T10:22:47.878Z | State PID is not independent binary attestation |
| Fixed routes and runtime origins | PASS | UI localhost:5288 and API /api/health HTTP200; runtime config api/ws 127.0.0.1:3316 | Live vendor run still required after restart |
| Existing ChatGPT history survives F5 | PASS | Explicit opt-in Chromium read-only test, 1 passed in 2.3s; Kalio fs_read origin retained and Devin-only audit absent | No new ChatGPT completion in this test |

Screenshot assets/codex-without-devin-audit.png saved by Playwright; not visually inspected in this run. First invocation lacked the explicit opt-in and skipped both tests; it is not a pass. Corrected invocation enabled opt-in and selected only recorded Codex test. Existing Devin audit test selects the last bubble but assumes QA181 turn, which no longer matches newer QA193 history; it was not run as post-deploy proof and needs exact-turn selection.

Default stack provider remains mock, force-env false, while approved sessions retain explicit Devin/Codex execution profiles. This deployment does not silently convert the default provider or prove real communication from HTTP health. Next required proof is real Devin readiness/completion on the restarted host, then ChatGPT completion and target preview availability. Original goal remains active.
