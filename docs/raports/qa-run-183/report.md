# QA183 — durable real Devin error/recovery verification

2026-10-04. Fixed UI http://localhost:5288/, API :3316, AppData kalio-forever-qa. Frontend QA175/backend QA167 unchanged, checkout C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, pre-test HEAD bb741455 plus preserved mixed dirty work. Chromium 1280x720. Read-only replay of QA181 real swe-2 turn OzSjtuCsZ7ZITyzYOVqvH, approved E:/Projekty/home-site. No additional Devin prompt, reset, provider mutation, file write or command.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Missing-file failure is durable | PASS | Exact status error, TOOL_EXECUTION_FAILED, NOT_FOUND and requested missing path | Other error types separately scoped |
| Devin continues after failed tool | PASS | Second durable fs_read contains nexora-home-site; final response visible | Retry/timeouts not tested |
| Tool failure visible after F5 | PASS | Exactly one failed tool card before/after reload, two Kalio origin labels, no Stop | Other workflow surfaces separately pending |
| Command boundary | PASS for audited window | Zero process.cmd.invocation since original QA181 submission | Not OS-wide process proof |

Playwright qa-devin-read-error-live.spec.ts, KALIO_DEVIN_READ_ERROR=1, KALIO_DEVIN_ERROR_REPORT_RUN=183, KALIO_DEVIN_ERROR_REPLAY_MARKER=QA181_ERROR_1791106578162: 1 passed (2.5s). Two earlier harness assumptions corrected from actual payload evidence; replay avoids repeating real LLM/tool execution. Screenshot assets/error-recovery-after-f5.png saved and visually inspected, showing failed first read, successful second read and normal idle composer.

No app bug was established in this scenario. Full requested goal remains active; this closes only missing-file error/recovery proof for the existing real Devin chat. Earlier reports preserve their failed-test outcomes.
