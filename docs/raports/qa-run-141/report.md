# QA141 — deployed durable interruption label, provider preservation

Fixed QA http://localhost:5288, API http://127.0.0.1:3316/api. Existing AppData kalio-forever-qa database. Hidden manager launcher PID 24796; controlled stack stop/start, no database reset.

| Acceptance | Status | Evidence | Remaining |
|---|---|---|---|
| Consistent recovery snapshot | PASS | SQLite backup .tmp/qa-provider-backup/qa-before-history.db, integrity_check=ok, path gitignored | Backup contains sensitive local data; never commit/upload |
| Profile/credential/settings preservation | PASS | Exact row hashes unchanged: execution_profiles 21, credentials 1, app_settings 4 | Does not test token decryption/auth after restart |
| New journal HTTP route | PASS | Exact QA138 turn returned interrupted, revision 4, errorCode INTERRUPTED, Turn interrupted by user | Other outcomes not live exercised |
| F5 interruption label | PASS | Read-only Playwright 1 passed (5.3s), Interrupted attached to QA91_STREAM_BEGIN partial | Wording currently Interrupted, not localized Stopped |
| Final follow-up preserved, idle UI | PASS | QA138_READ_RESULT visible, no Stop agent, transport recovery banner absent | New live generation not performed |
| Desktop/mobile saved evidence | PASS | assets/stopped-history-1280.png and stopped-history-390.png | Physical device not tested |

Backend journal uses interrupted for user Stop, while the LLM audit records cancelled. Both are terminal non-success states; projection preserves backend wording rather than inventing completion. QA138 cancellation-clarity defect is closed for this real persisted turn after F5. Live immediate-stop badge parity is not yet fully proven.

Build source is the current dirty worktree, not a clean release commit. Whole objective remains open, including CMD bursts, queue races and feature-owned commit hygiene.
