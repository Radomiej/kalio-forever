# QA378 — clarify Devin native-audit affordance

2026-10-04. Fixed QA localhost:5288. Existing completed real swe-2 turn QA377; no new LLM prompt, host reset, target edit or terminal command.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| ORIGIN-01 Panel availability does not imply native execution | PASS | Renamed button to Devin tool permissions and explicitly explained scope, separate Kalio calls and approval-versus-execution boundary. | Existing native row classifications unchanged. |
| ORIGIN-02 MCP-only activity is not native evidence | PASS | Added panel regression with completed mcp_call_tool wrapper. Projection already excluded it; no native completion row appears. | No new native-provider execution requested. |
| ORIGIN-03 Persisted real QA turn after F5 | PASS | Opened final QA377 panel after frontend build/reload: No correlated native evidence, with actual fs_read still labelled Kalio separately. Screenshot kalio-vs-native.png. | No claim of absence of all possible unscoped legacy events. |
| ORIGIN-04 Local verification and fixed-QA deployment | PASS | Fail-first: 4 label tests failed / 2 passed; final panel and projection suites 16/16 PASS. Frontend tsc + Vite build exit 0. Running preview served rebuilt assets without stack restart. | Existing large-chunk warning; production not tested. |

Root cause: a static discovery button described the native evidence category even when no such evidence existed. The classifier was already excluding MCP wrapper calls. Changed presentation only, not permissions, tool dispatch, runtime contracts or graph state. Failed/loading/refresh states and native policy-block handling retain regression coverage.

QA377 P3 wording issue is resolved in measured fixed-QA state. Startup console report, full cold Devin startup and broader goal-loop acceptance remain open. Unrelated dirty work preserved.
