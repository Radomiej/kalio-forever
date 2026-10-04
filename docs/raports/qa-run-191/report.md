# QA191 — actual Devin build approval survives F5 without duplicate command

2026-10-04. Fixed UI http://localhost:5288/, API :3316, AppData kalio-forever-qa. Backend QA167/frontend QA188 index-DoDTxWPE.js unchanged. Checkout C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, branch codex/kalio-provider-runtime-ux, pre-test HEAD 1a11a799 plus preserved mixed dirty work. Chromium 1280x720. No reset/provider change/deploy.

Real exact swe-2 session W4fggLSunrJB41C24MV7C; warm static readiness passed immediately before UI start. Approved target E:/Projekty/home-site, exact command npm, args [run, build], cwd E:/Projekty/home-site. Marker QA191_BUILD_1791108243630, turn puQCmvA-_I1N3dcMM-gjX.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Pending confirmation after F5 | PASS | One Confirm visible after reload; full args visible; audited tool_call set identical to before F5 | Did not independently assert requestId equality; proves same call and one visible approval |
| No execution before acceptance | PASS in audited window | Zero process.cmd.invocation before and after pending reload | Not an OS-wide process trace |
| Single manually approved build | PASS | Exact args checked then UI Confirm; one terminal_spawn and exactly one process.cmd.invocation | Other command categories separately scoped |
| Actual final output | PASS | Two durable tool results; terminal_output status exited, exitCode 0, Vite 5.4.21/26 modules/built in 409ms | Generated demo still fictional/non-sending form |
| Final F5 | PASS | Unique result heading retained, current run drained, no reconnect status | Backend restart mid-approval is not this test |

Playwright qa-devin-approved-build-live.spec.ts with KALIO_DEVIN_APPROVED_BUILD=1, KALIO_DEVIN_BUILD_REPORT_RUN=191, KALIO_DEVIN_BUILD_PENDING_RELOAD=1: 1 passed (10.9s). Added optional pending-reload path to existing real build regression; normal path unchanged. Artifacts: assets/build-awaiting-confirmation.png, assets/build-pending-after-f5.png, assets/build-result-after-f5.png. Pending-after-F5 and final screenshots visually inspected. Build artifacts remain index-BWlm4q-R.js/css index-DDzjYeyO.css; no source edits/install/native tools/web/target commit requested.

Only terminal_spawn/terminal_output calls permitted/asserted in this window. Test finally cancels visible pending approval or stops surviving run on failure. This is actual F5 while confirmation waits, extending QA190's local linkage test. It does not prove process restart recovery, all approval races, total absence of console spam or full original-goal completion.
