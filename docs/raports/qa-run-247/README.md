# QA247 — real Codex communication on current QA

2026-10-04, Europe/Warsaw. Fixed QA UI localhost:5288, API 127.0.0.1:3316/api, persistent AppData QA. Backend includes Devin barrier commit 3b1d7181 and Codex single-flight 8d6e1659. Existing ChatGPT-authenticated Codex session yvD83rgDA_ZHvUwJKlo_S, exact gpt-6-luna, approved Home Site workspace. No target files or tools requested.

Model discovery explicitly refreshed before GET-only readiness: models/check returned 201, expected model present, epoch AeVtRmvDEt_uzHSzaEMa7. All exact-profile readiness checks PASS, including strict/manual approval, inherited MCP disabled and no current run/children. This explicit discovery starts/checks the host; it does not prove first-prompt automatic reconnection without Recheck.

qa-codex-restart-recovery-live.spec.ts: **1 PASS, 12.2s**. Two real UI prompts, recovered and follow-up, marker timestamp 1791117414416. Assertions: both headings visible, no Stop, empty current run, same epoch across both, both answers survive F5, no connection status, zero tool_call, zero process.cmd.invocation during the two turns, exactly two llm.turn.completed.

| Acceptance | Status | Boundary |
| --- | --- | --- |
| Current QA real ChatGPT/Codex response and follow-up | PASS | Real account-backed generation, not mock |
| Stable host and drained lifecycle/F5 | PASS | Same epoch, completed rendered replies |
| No CMD or tools during these prompts | PASS scoped | Audit since test start; not OS-wide monitoring |
| Durable opt-in / first-prompt auto-connect | UNVERIFIED | Explicit catalog refresh used |
| Active reasoning UI transitions | UNVERIFIED | These short replies do not guarantee a visible reasoning interval |

[Screenshot after F5](assets/codex-recovery-after-f5.png) visually inspected, 1280x720. QA and Home Site preview left running. Runner NO_COLOR/FORCE_COLOR warnings only. No provider or approval configuration changed.
