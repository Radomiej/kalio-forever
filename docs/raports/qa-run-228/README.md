# QA228 — model audit filtering before the row limit

Date: 2026-10-04. Environment: fixed QA localhost:5288 / API :3316.

## Acceptance

| Requirement | Status | Evidence / remaining |
| --- | --- | --- |
| Exact label filtering before LIMIT, hot and archive | PASS locally | SQLite controller regression; all 26 controller tests pass |
| Graph requests only model-start entries for the selected session | PASS locally | 2 hook tests pass; query label is llm.turn.started |
| API and web typecheck | PASS | Both tsc --noEmit commands exit 0 |
| API and web production builds | PASS | API 680 files compiled, zero TSC issues; web 3118 modules, 4.97s |
| Live API filter after backend restart | PASS | 103 model-start entries, zero different labels |
| Rendered graph warning removed and F5 hydration preserved | PASS for exact saved Devin build | Read-only Chromium test 1 PASS, 3.4s; screenshot inspected |

## Change and evidence

Previously the graph requested all runtime events and applied its 2000-row limit before selecting model evidence. Tool events could therefore displace older model-start records. The additive optional `label` query now becomes a parameterized exact SQL condition in both hot and archive branches, before the shared LIMIT. No persisted records or provider settings were changed.

Fail-first test at 13:45:31 returned model-hot and newer-noise rather than both model records. During source review the assertion order was corrected to the existing chronological response contract: model-archive, model-hot. The undesired noise inclusion was the regression, not chronological ordering.

GREEN: API 26 tests, 1.01s at 13:49:28; web 2 tests, 1.06s at 13:49:32. Scoped git diff --check passed. Web build warns about the existing large bundle; this change does not resolve bundle size.

The frontend runtime-config uses API/ws origin http://127.0.0.1:3316. After confirming no active chat runs in the QA database, the managed fixed-port stack was restarted with the existing AppData data root and built artifacts. New backend PID 4120, frontend PID 37968; started at 2026-10-04T11:53:42Z (state display converted to local PowerShell formatting). Local consistent SQLite backup: ignored .tmp/qa-provider-backup/qa-before-228.db.

Execution profiles (21 rows), credentials (1 row), and app settings (4 rows) had identical SHA256 digests before and after restart. No secret values were printed. The unchanged global fallback remains mock; the saved Devin turn uses its explicit real execution profile, not that fallback.

The exact saved turn 37YMcjrxMk7Yuxw07qgx7 retained one grouped node, two Kalio-origin tool calls, terminal uIH17By0XkK_JQ1q21Y4B, exitCode 0, and 26 modules after F5. Screenshot: assets/devin-group-after-f5.jpg. Visual inspection confirms no model-audit-limit warning. This is persisted-history/reconnect proof, not a new post-restart Devin request; live communication after restart remains a separate gate.
