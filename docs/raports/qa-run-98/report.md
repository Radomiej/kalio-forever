# QA98 — Real Devin queue drains once across reload

2026-10-03. Fixed QA localhost:5288 / API3316, same AppData data and HomeSite session W4fggLSunrJB41C24MV7C, exact swe-2 strict bridge. Starting HEAD9960705 plus preserved earlier dirty changes. Static readiness16/16 passed before prompt submission. No data reset, provider changes, filesystem tools or terminal commands in this test.

Repository Playwright drove actual Talk UI. The test now waits explicitly for the hydrated Chat message textbox before checking the conversation model; it does not send through the transient launch screen. Chromium1280x720, two no-tool prompts: first produces30 tips, second requests a short marker. Second sent while first generated visible text. Queued(1) observed, screenshot saved, F5 during active queue, both responses retained after completion and a second F5. No stale Stop, responding placeholder or queue badge.

One test passed20.7seconds. Two user messages and exactly one llm.turn.started/completed per turn were verified through durable history/audit; eighteen audit rows, zero process.cmd.invocation.

## Exact ordering

| Event | Turn | Timestamp |
| --- | --- | --- |
| First started, model swe-2 | VqICP2I3sAuOBHtj94Z_k | 1791039871210 |
| First completed | VqICP2I3sAuOBHtj94Z_k | 1791039883841 |
| Second started, model swe-2 | SsMSS4knjsOt43IoVsVr8 | 1791039883870 |
| Second completed | SsMSS4knjsOt43IoVsVr8 | 1791039885239 |

Audit since1791039870499. Ordering separately read and confirmed after the test: second starts after first completes, not concurrently. Current-run empty afterwards; UI5288 and HomeSite preview57868 HTTP200.

| AC / PIT | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Queue during real generation / PIT-36 | PASS | Visible assistant text and Queued(1) | Multiple queued prompts not tested |
| Sequential exactly-once drain | PASS | Two distinct durable turns, one start/completion each, ordered timestamps | Crash recovery not tested |
| F5 while queued / PIT-37 | PASS | Both final headings after reload | Physical mobile not tested |
| No command in this scenario | PASS | Zero scoped CMD events | OS-wide census not claimed |
| Reset reliability | OPEN P2 | QA97 shutdown timeout | No root-cause fix proven |
| Full integration closure | OPEN | Real queue path now proven | Native denial and broader ChatGPT flow remain |

## Screenshots

[Queued while first turn generates](assets/queued-during-generation.png), [both completed after F5](assets/both-completed-after-f5.png). First screenshot visually inspected.

QA97 first attempt failed before any prompt due to transient launch state; screenshot recovery failed and is explicitly documented there. No claim that this test repaired product hydration or the reset timeout. Only the test's hydration wait changed. No production or pricing assertion.
