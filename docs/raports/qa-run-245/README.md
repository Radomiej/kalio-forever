# QA245 — real Devin build after barrier deployment

2026-10-04. Fixed QA :5288/:3316, AppData QA database, Chromium desktop screenshot 1280x720. Real Devin ACP exact swe-2, session W4fggLSunrJB41C24MV7C, project E:/Projekty/home-site. Cold readiness passed immediately before the UI action. Backend patch 3b1d7181 deployed in QA244; frontend unchanged from QA242.

Playwright qa-devin-approved-build-live.spec.ts: **1 PASS, 10.9s**. Marker QA245_BUILD_1791117163193; durable turn HccFyxg08nDpfWthfFpDe. Task requested only one Kalio terminal_spawn npm args [run,build], exact approved cwd, then terminal_output. No source edits, installation, native tools, web or commits requested.

| Acceptance | Status | Evidence |
| --- | --- | --- |
| Pending approval shows full arguments | PASS | One Confirm, exact audited payload; screenshot |
| F5 preserves pending approval without execution | PASS | Same tool calls, one Confirm; zero process.cmd.invocation before approval |
| Approved command runs once | PASS | One terminal_spawn tool_call and one process.cmd.invocation after confirmation |
| Actual build success | PASS | Terminal Ep5S5x4mbpXoZeMsOQan8 exited, exitCode=0; 26 modules, Vite 5.4.21 built in 405ms |
| Final answer survives F5 | PASS | Exact result heading visible, connection status cleared, no current run |
| OS-wide CMD absence / active thinking transitions | UNVERIFIED | Not measured by this scenario |

Assets: [pending approval](assets/build-awaiting-confirmation.png), [pending after F5](assets/build-pending-after-f5.png), [final after F5](assets/build-result-after-f5.png). Final screenshot visually inspected: exited/0, build output and terminal_spawn/terminal_output marked Kalio.

Build outputs: index-BWlm4q-R.js and index-DDzjYeyO.css. Supporting post-test fetch initially failed with sandbox EACCES; rerun outside sandbox succeeded and confirmed durable results. This sandbox failure is not an application defect. NO_COLOR/FORCE_COLOR runner warnings occurred, without test failure. The scenario proves the declared command/approval/history slice, not full production readiness or account pricing eligibility.
