# QA233 — real ChatGPT recovery on single-flight deployment

Date: 2026-10-04. Fixed QA localhost:5288 / API :3316. Real ChatGPT-authenticated Codex app-server, model gpt-6-luna, existing session yvD83rgDA_ZHvUwJKlo_S. Deployment includes patch 8d6e1659.

| Acceptance | Status | Evidence |
| --- | --- | --- |
| CMD audit after QA232 restart | PASS for bounded observation | Since 1791115639824: cli-agent.probe 4, codex.app-server 1, codex.mcp-config 1 |
| Fresh catalog and readiness | PASS | Existing epoch dwhmg7-0157EI9eesevFL retained; exact model present; all readiness checks pass |
| Real recovered conversation and warm follow-up | PASS | qa-codex-restart-recovery-live.spec.ts, 1 PASS, 11.2s |
| Stable host across both requests | PASS | Same processEpoch asserted for both completed turns |
| No tools or CMD in these two turns | PASS scoped | Zero tool_call and process.cmd.invocation; two llm.turn.completed |
| F5 and drained lifecycle | PASS | Both headings restored after reload, no Stop agent or connection warning; current run empty |

Screenshot assets/codex-recovery-after-f5.png inspected. Model discovery was explicitly refreshed using the existing models/check endpoint before readiness; it did not create a new host epoch. QA232's concurrent checks had already started the cold host, so this does not prove first-prompt startup without manual discovery.

Boundaries: audit is application-recorded and time-scoped, not an OS-wide continuous process trace. The original broad CMD-spam cause is not conclusively attributed solely to the fixed Codex race. Durable integration opt-in/autoreconnect and remaining user-facing issues remain open; fixed QA remains running.
