# QA288 — actual ChatGPT/Codex communication after QA deploy

Date: 2026-10-04, Europe/Warsaw. Fixed QA http://localhost:5288/, API http://127.0.0.1:3316/api, persistent AppData settings preserved. Runtime source 997bfd3a, latest prior evidence commit 9d7f5fa8. In-app browser, default viewport. No target edits, builds, terminal tools, provider/settings mutation or reset.

## Steps and evidence

Agent runtimes initially showed Codex disconnected, not started, zero sessions. Clicked the existing integration's Recheck once; UI became Online/Connected. This explicitly starts the configured host, does not add permission, and does not prove automatic reconnect on application startup. A locator timeout while opening the collapsed card was handled by refreshing the live AX tree and clicking its observed element; no blind repeated Recheck.

GET-only strict preflight passed all 16 checks for codex-local-1bd82ba45243e8a3a0c4aa0478538f67, persona oiod04Nvs_F0T_yKVuP4g, exact gpt-6-luna, approved E:/Projekty/home-site and persisted session yvD83rgDA_ZHvUwJKlo_S. External configured MCP inheritance remains false; six Kalio tools and manual write/command confirmations unchanged.

From Talk, selected that exact session and submitted a no-tools communication prompt. Actual response heading QA288_CODEX_RESULT and sentence Rozmowa działa poprawnie appeared. Stop was absent after completion; heading persisted after F5. Captured [screenshot](assets/codex-after-f5.png), byte-verified at 108837.

Scoped audit since 1791125592968: five rows, llm.turn.started model gpt-6-luna, codex.turn.started, llm.turn.completed toolCallCount=0, zero tool_call rows. Kalio turn teFj05hM0_PVFckk3jwTw; provider turn 01a10767-9cb3-70b1-9981-ced3e28d6697. Host remains online with one registered session, epoch LTWF-SSegbfDVj53gB9uy.

## Bounded status/process observation

Ten sequential pairs of GET /runtime/devin-cli/status and GET /runtime/native-cli-integrations, no refresh/start/reset parameter. Get-Process cmd before and after: 70 -> 70, no new cmd PID. Each provider retained exactly one process epoch: Devin cdwKfw7sW-ZEAOHd6scDk; Codex LTWF-SSegbfDVj53gB9uy. The sample lasted approximately 0.25s: it demonstrates no new surviving cmd process across this bounded status batch, not absence of short-lived windows, long-term leaks or historical causality. The 70 pre-existing cmd processes were not killed or attributed to any particular agent.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| CODEX-CHAT | PASS | Real explicit-profile response, exact model in audit, zero tools | Model quality and tool execution not tested here |
| CODEX-F5 | PASS | Heading restored; Stop absent at completed response | Full reconnect/queue/Stop workflow remains broader scope |
| CODEX-STARTUP | UNVERIFIED | Explicit Recheck required and worked | Persisted opt-in/backend autoreconnect remains open |
| STATUS-CMD | PASS, bounded | Ten status pairs, 70->70, no new surviving PID, unchanged epochs | Historical CMD issue and short-lived process behavior unverified |
| OVERALL | UNVERIFIED | Both core providers have current fixed-QA communication evidence (QA286/288) | Remaining runtime defects, release gate, UX requirements and Jev goal loop still open |

Verdict: current fixed-QA Codex communication/F5 slice passes. Original objective remains active. No claim that all integrations or all CMD behavior are fixed.
