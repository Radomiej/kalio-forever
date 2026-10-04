# QA244 — deploy Devin ACP initialization barrier

2026-10-04, Europe/Warsaw. Fixed QA UI http://localhost:5288 / API http://127.0.0.1:3316/api. Checkout codex/kalio-provider-runtime-ux at 3b1d7181; unrelated dirty files preserved. Backend artifact passed the QA243 gate: 33 tests, typecheck and build.

Before restart, chat_runs contained completed 148, cancelled 1, failed 1, interrupted 16, interrupted_needs_retry 1; no active run. Consistent SQLite backup saved to ignored .tmp/qa-provider-backup/qa-before-244.db. Managed stack restarted with the same AppData data root and fixed ports, skip-build, direct runtime, use-env-llm. Startup completed successfully; backend log backend-1791117093108-2052.log. The restart stopped the previously backend-owned Home Site preview, subsequently restored in QA246.

| Acceptance | Status | Evidence / boundary |
| --- | --- | --- |
| Preserve providers, credentials, settings | PASS | SHA256 equality versus backup for execution_profiles, credentials, app_settings; no secrets printed |
| Fixed QA starts | PASS | stack-manager health/start gates; UI and API used successfully by QA245/246 |
| Exact Devin cold readiness | PASS | GET-only session gate: exact swe-2, approved project, strict profile, bridge on, native filesystem/terminal off, six-tool persona, manual confirmations, fresh authenticated catalog, zero hosts/current run/children |
| Real UI generation after deploy | PASS | QA245 build and QA246 preview |
| Live simultaneous ACP initialize race | UNVERIFIED | Controlled fixture regressions in QA243; live cold-start success does not independently reproduce concurrency |
| Historical global CMD-spam cause | UNVERIFIED | Session audit counts only; no machine-wide causal conclusion |

Global fallback remains mock/mock with forceEnvLlm=false; explicit approved conversation uses its persisted Devin profile, not fallback. No default-provider change, permission expansion, autostart addition, schema migration or target-source edit. Full integration UX and Jev goal loop remain outside this receipt.
