# QA179 — actual confirmed Devin write/read round trip

2026-10-04. Fixed QA UI http://localhost:5288/, API :3316, AppData kalio-forever-qa. Checkout C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, branch codex/kalio-provider-runtime-ux, pre-test HEAD 29c4f21a plus preserved mixed dirty work. Frontend QA175 index-DW34-EoM.js, backend QA167 deployment. Chromium desktop 1280x720.

Real exact swe-2 session W4fggLSunrJB41C24MV7C, strict ACP profile, approved project E:/Projekty/home-site. Warm static preflight passed immediately before UI submission. Single new documentation file created through Devin/Kalio only: E:/Projekty/home-site/docs/kalio-qa-handoff-1791106010500.md. It records fictional React/Vite demo, non-sending demo form, build command and unique verification marker. Retained deliberately as QA handoff evidence, not deleted or committed in the target project. No source code overwrite, terminal command, web or install requested.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Exact manual write approval | PASS | Pending UI card and audited fs_write args exactly match path/content; Confirm clicked after inspection | Other approval surfaces not tested |
| Actual write/read round trip | PASS | One fs_write then one fs_read, two durable tool_result messages; bytesWritten and exact full read content asserted | Existing-file update and restart mid-write separately scoped |
| CMD boundary | PASS | Zero process.cmd.invocation throughout scoped action | Not OS-wide/native process proof |
| F5/provenance | PASS | Unique final response retained; both origin labels Kalio after F5; Stop absent before reload | Other consumers/live updates separately pending |

Playwright qa-devin-approved-write-live.spec.ts: 1 passed (8.0s), test 7.2s. Turn tvDN-Zbk9tzfWGamWX4dw; file 181 bytes in rendered result. Screenshot assets/write-awaiting-confirmation.png and write-read-after-f5.png saved; final screenshot visually inspected. File path unique by timestamp prevents overwriting an existing project document. Test cleanup cancels pending confirmation or stops a surviving run if assertions fail; no broad process kill or file cleanup.

This extends real communication proof from reads/builds to manually approved project writes. Full original goal is still active; no claim that every settings/UX issue, all native tool activity, console spam or production readiness is resolved.
