# QA200 — HomeSite preview recovered through Devin

2026-10-04, fixed QA backend e53b3377/frontend QA188, actual Devin ACP exact swe-2 session W4fggLSunrJB41C24MV7C. Warm static readiness passed before UI action. Prior HTTP probe confirmed preview57868 refused connection; test also checks no existing healthy preview before launch.

Exact approved command npm args [run, preview, --, --host, 127.0.0.1, --port, 57868, --strictPort], cwd E:/Projekty/home-site. Pending full arguments inspected by test and Confirm clicked under existing user authorization. No source edits, build, install, target commits, web or native tools requested.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Single preview launch through Kalio | PASS | One terminal_spawn, zero CMD audit before approval and one after; only spawn/output calls | Not OS-wide window trace |
| Working rendered project | PASS | HTTP200 and visible H1 at http://127.0.0.1:57868/; full-page screenshot visually inspected | Automatic preview restoration after QA restart not implemented |
| Durable response after F5 | PASS | Final heading retained, no Stop/connection status; response screenshot saved | Response screenshot not visually inspected here |

Playwright qa-devin-preview-recovery-live.spec.ts explicit opt-in/report200: 1 passed in9.0s, exit0. Screenshots assets/preview-approval.png, preview-response-after-f5.png, home-site.png. Preview left running for manual review. QA restart stops backend-owned terminals; this recovery demonstrates explicit relaunch, not persistence of live processes across restart. Provider settings unchanged by the recovery. Full goal remains active for outstanding source/UI/native acceptance and closure.
