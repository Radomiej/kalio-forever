# QA230 — real ChatGPT/Codex Home-site read after QA restart

Date: 2026-10-04. Fixed QA localhost:5288, API :3316. ChatGPT-authenticated Codex app-server, exact gpt-6-luna, session yvD83rgDA_ZHvUwJKlo_S, project E:/Projekty/home-site.

| Acceptance | Status | Evidence |
| --- | --- | --- |
| Host and current-epoch model catalog ready before prompt | PASS after manual Recheck | All static readiness checks passed |
| Real project read through Kalio UI | PASS | qa-codex-project-read-live.spec.ts, 1 PASS, 19.4s |
| Exact tool and actual content | PASS | One fs_read package.json; nexora-home-site and vite build in durable result |
| No terminal activity in this read | PASS scoped | Zero process.cmd.invocation in session/time-scoped audit |
| Provenance and completed result after F5 | PASS | One Kalio origin badge; no Stop agent; screenshot inspected |
| Automatic connected-host restoration after backend restart | UNVERIFIED / observed gap | Initial readiness found disconnected host and missing catalog; manual Recheck required |

Marker QA230_CODEX_READ_1791115266838; turn 2ld1-jwoFAVbyiMjKbB0e. Screenshot: assets/codex-project-read-after-f5.png.

The initial static readiness failed on host connectivity and absent model catalog. UI Settings > Agent runtimes > Codex showed Not started / Disconnected. Clicking Recheck recreated the host and discovered a fresh catalog; no profile or permission edits were made. Readiness was rerun and passed before sending the prompt. Own temporary browser tab was closed; fixed QA remains running.

[P2] Reconnection UX/runtime follow-up: the user requested durable opt-in with backend restoration after restart. This test proves recovery using Recheck, not automatic startup restoration or direct first-prompt recovery without it. Inspect the persisted connection policy and startup caller before implementing a fix; do not infer that a disconnected idle host alone means chat cannot lazy-start.

Boundary: real read/F5 communication only. This attempt does not prove writes, terminal approval, every model, global process-spam absence, or whole-product completion.
