# QA198 — real Devin SWE-2 build after QA deployment

2026-10-04. Fixed QA backend deployed at e53b3377 in QA197, frontend QA188. Real Devin CLI ACP exact swe-2, session W4fggLSunrJB41C24MV7C, approved E:/Projekty/home-site. Cold static readiness passed immediately before the UI run; no existing host/current run/child execution at that snapshot. No provider settings changed.

Marker QA198_BUILD_1791109530354, turn fjbU2ujmlXTkH1Yif5u65. Chromium 1280x720, actual prompt through Kalio composer. Exact command npm, args [run, build], cwd E:/Projekty/home-site reviewed in pending tool card and manually confirmed by authorized test automation. No source edits, install, web, native tools or target commits requested.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Real communication after backend restart | PASS | Actual SWE-2 prompt, tool requests and final response; Playwright 1 passed in 10.5s | ChatGPT new completion separately required |
| Pending approval survives F5 | PASS | One visible Confirm, unchanged original tool-call audit records, no CMD audit before confirmation | Backend restart during approval not tested |
| Build executes once and exits successfully | PASS | One terminal_spawn and one process.cmd.invocation in scoped audit; terminal lCbRWGFdb-0GoyWSNKDVy, exitCode0, Vite5.4.21 built26 modules in398ms | Scoped audit is not OS-wide CMD proof |
| Durable final response after F5 | PASS | Heading retained, current run drained, saved tool results; final screenshot visually inspected | Other consumers not reverified here |

Saved screenshots: assets/build-awaiting-confirmation.png, build-pending-after-f5.png, build-result-after-f5.png. Final image shows idle composer, terminal exited0 and Kalio origin for terminal_spawn/output. Build assets index-BWlm4q-R.js and index-DDzjYeyO.css match prior target output. Test handle24407 was resumed once and explicitly completed exit0; no duplicate run/restart on observation yield.

This proves the authorized HomeSite build path with real Devin on the deployed backend. It does not establish free-price eligibility, every native permission scenario, preview availability, all UX fixes or full goal completion. Original goal remains active.
