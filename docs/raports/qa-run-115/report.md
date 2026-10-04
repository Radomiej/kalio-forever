# QA115 — Controlled deployment and real Devin preview recovery

2026-10-04. Deployed built API containing d385a6d Codex model admission; preserved unrelated dirty build contents. Before restart both explicit Devin and Codex canary sessions returned no current run. Verified launcher43836/start-qa.ps1 and managed backend37412/frontend43700 identities; stopped only that launcher and managed stack, then launched start-qa.ps1 -SkipBuild hidden.

New launcher25180, backend45808, frontend13956. Fixed UI5288/API3316; unchanged AppData/kalio-forever-qa/kalio-qa.db. Execution-profile SHA256 before/after DF8DD360EF8A6B12FAA2EDBA7E6913D5F8110A4331E45A26BDCE79065D11714B (19 profiles). This proves profile preservation, not an inventory of encrypted credentials. Global fallback remains mock; explicit HomeSite session overrides it with exact Devin swe-2.

Devin GET-only static readiness16/16 PASS after restart: exact project/profile/six tools/manual HITL/bridge/catalog/no host/current run/children. Real Chromium UI preview recovery PASS10.8s (test10.0s), one reviewed npm run preview command through Kalio terminal_spawn, then matching running terminal_output after durable completion. Exact turn mmZIA1WqonMRcxKNHnrql; terminal h-QMZYUz1NKhUAdtXtQmt. No native command, target write, build or direct target edit. Screenshot visually inspected: final response and two completed Kalio-origin tool rows, no active Stop.

Final HTTP200: localhost5288, API3316/api/health, preview127.0.0.1:57868.

| Acceptance | Status | Boundary |
| --- | --- | --- |
| Controlled same-DB QA deployment | PASS | New managed process identities and health |
| Profiles preserved | PASS | Equal full-profile hash |
| Real Devin UI command/approval/result | PASS | Exact turn and command through Kalio |
| HomeSite preview restored | PASS | HTTP200 and correlated running output |
| Codex rejection visible through UI | OPEN | Deployed guard, not yet live UI-proven |
| Full integration/native categories/CMD stress | OPEN | Not closed by this recovery test |

Screenshots: [approval](assets/preview-approval.png), [completed](assets/preview-completed.png).
