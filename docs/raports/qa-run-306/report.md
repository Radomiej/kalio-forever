# QA306 — real Codex read through Kalio

2026-10-04. Fixed QA UI localhost:5288, API 3316. Existing session `yvD83rgDA_ZHvUwJKlo_S`, profile `codex-local-1bd82ba45243e8a3a0c4aa0478538f67`, model gpt-6-luna, project E:/Projekty/home-site. In-app browser tab 9. No target edits, terminal commands, provider changes or QA restart.

Initial static preflight: 15 PASS, 1 FAIL: fresh exact model catalog did not match current process epoch although host was online. One scoped Codex Recheck from the UI restored 16 PASS. This is recovery evidence, not a fix for catalog freshness or automatic startup reconnect.

Sent QA306 read-only prompt through the chat UI, requesting exactly one Kalio fs_read of package.json. Final response returned project `nexora-home-site`, build script `vite build`, and heading QA306_CODEX_READ_RESULT. UI showed fs_read with Kalio provenance.

Scoped `/api/audit-log?sessionId=yvD83rgDA_ZHvUwJKlo_S&limit=100`, request boundary 1791132904057: 9 rows, one llm_request, one llm_response, five runtime events, exactly one fs_read call and result; codex.turn.started, codex.tool.requested, codex.tool.result, llm.turn.completed. No terminal/tool loop in this turn. This does not prove absence of OS console flashes.

After F5: final heading visible, Stop agent absent. Screenshot: codex-read-after-refresh.png.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Real Codex communication and Kalio read | PASS | UI result and scoped audit | Broader lifecycle/release gates remain |
| Durable final state after refresh | PASS | Heading visible, no Stop agent | Other running/approval recovery states not retested |
| Fresh catalog without manual recovery | FAIL | Initial preflight mismatch; Recheck recovered | Diagnose catalog expiry/process epoch ownership |
| No console flashes | UNVERIFIED | No event tracing permission, QA305 | Startup event plus visual capture required |
| Home Site unchanged | PASS for requested workflow | Only fs_read call/result | No new site build or design audit in this run |

Read-only audit attempts first used an incorrect sessions/audit endpoint (404); discarded those attempts and inspected the controller before using the actual audit-log endpoint. No failed measurement was reported as a success.
