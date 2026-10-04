# QA100 — Exact preview result visible after F5

2026-10-04. Fixed built QA localhost:5288 / API3316, same AppData database, starting HEAD612228c plus preserved unrelated changes. Existing approved HomeSite session W4fggLSunrJB41C24MV7C and swe-2 turn oG5g6mCaEkYS4zAKawY_R from QA99. Read-only browser test: no LLM prompt, tool dispatch, confirmation or preview restart.

QA99's restore test used global last Toggle details before the new assistant/tools rendered; it opened the old build output. New test scopes the agent-turn-bubble by unique terminal Dd51uzNehRl0Dq7HwYaDT, then terminal_output within that turn. Observed accessibility tree used to choose controls; waits for hydrated Chat message rather than launch-screen state.

System Node outside sandbox, external-server Playwright tests/devin-preview-history-live.spec.ts --project=chromium, KALIO_DEVIN_PREVIEW_HISTORY_QA100=1. One test passed3.6seconds. Chromium1280x720. Actual latest tool result shows the correct id, running status, port57868 and execution origin Kalio. F5 rehydrates the same result; no Stop button remains. Durable history confirmed one assistant and three tool_result messages for that exact turn before the browser test. No pricing/production claim.

| AC / PIT | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Correct turn/tool inspected / PIT-04 | PASS | Unique terminal in current turn, not global last details | Original spawn test still needs durable turn-scoped completion helper |
| Tool provenance | PASS | Kalio origin badge on terminal_output | Native denial is separate |
| Result after F5 / PIT-37 | PASS | Correct id/running state retained | Active streaming reload separate |
| No duplicate spawn | PASS | Test contains no send/confirm action | Existing running preview only |
| Overall integration | OPEN | Real Devin evidence accumulated | Reset root cause and broader ChatGPT acceptance remain |

Screenshots: [current result](assets/current-preview-result.png), [same result after F5](assets/current-preview-result-after-f5.png). This closes the existing-result visibility question, not a rerun of QA99's failed spawn test. The original restore test must not be treated as corrected merely because this read-only inspection passes.
