# QA101 — Turn-scoped preview completion verification

2026-10-04. Fixed QA UI localhost:5288, API3316, existing AppData database. Starting HEAD6e114bc with earlier changes preserved.

The original restore test now waits for exactly one durable `llm.turn.completed` event for its submitted turn. It reads only that turn's tool results, requires one exact preview command, and inspects the matching terminal_output inside the matching UI turn. A preflight prevents starting another preview when port57868 already serves successfully.

The shared verification was exercised on existing real Devin swe-2 turn `oG5g6mCaEkYS4zAKawY_R` in session `W4fggLSunrJB41C24MV7C`. System Node, external-server Chromium Playwright: one test PASS, total8.1seconds, test3.7seconds. No new prompt, confirmation, command, reset or provider change was issued.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Durable exact-turn completion | PASS | Shared helper finds exactly one matching completion audit event | Existing completed turn only |
| Exact terminal and Kalio provenance | PASS | Matching command, terminal id and running result; Kalio UI badge | Native-tool denial remains separate |
| History after F5 | PASS | Same result and terminal id, no Stop button | Active-stream reload tested separately |
| Original cold-start restore workflow | NOT REPLAYED | Test corrected to use verified shared helper | Preview already running; do not create duplicate server |
| Overall Devin/ChatGPT closure | OPEN | No broad completion claim | Reset timeout root cause, native denial and ChatGPT acceptance remain |

Screenshots: [result](assets/current-preview-result.png), [result after F5](assets/current-preview-result-after-f5.png). Automated assertions verified these states; this run does not add a separate visual-design audit.
