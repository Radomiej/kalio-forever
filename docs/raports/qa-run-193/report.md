# QA193 — real Devin approval waits over 70 seconds

2026-10-04. Fixed QA UI http://localhost:5288/, API :3316, AppData kalio-forever-qa. Backend QA167/frontend QA188 index-DoDTxWPE.js unchanged. Checkout C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, branch codex/kalio-provider-runtime-ux, pre-test HEAD 0ffd1f5c plus preserved mixed dirty work. Chromium 1280x720. No reset/deploy/provider mutation.

Real exact swe-2, W4fggLSunrJB41C24MV7C, warm static readiness passed before submission. Approved E:/Projekty/home-site. Exact command npm args [run, build] cwd E:/Projekty/home-site; no source/install/native/web/target commit. Marker QA193_BUILD_1791108547808, turn n2d8qcLOWvj_bmluA88t-. During wait, supporting API confirmed provider devin-cli-acp/model swe-2/status waiting_for_human/phase tool_pending.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Actual approval beyond ordinary 60s boundary | PASS | Two 35s diagnostic intervals after pending F5; elapsed >=70000ms asserted before Confirm | Does not prove unbounded waits or every vendor version |
| No cancellation/retry/execution during wait | PASS in audited window | One visible Confirm; identical original tool_call records at each stage; zero process.cmd.invocation | No independent requestId equality or OS-wide trace |
| Build executes once after manual approval | PASS | Exact args reviewed, UI Confirm, one spawn and one CMD audit event | Other command kinds separately scoped |
| Actual terminal completion and F5 | PASS | Durable exitCode0/build output, current run drained, final heading retained after reload | Backend restart during approval not tested |

Playwright qa-devin-approved-build-live.spec.ts: 1 passed (1.3m), KALIO_DEVIN_APPROVED_BUILD=1, KALIO_DEVIN_BUILD_REPORT_RUN=193, KALIO_DEVIN_BUILD_PENDING_RELOAD=1, KALIO_DEVIN_BUILD_LONG_APPROVAL=1. Optional delay is explicitly a diagnostic timeout-boundary probe, not a runtime stabilization fix. Existing ordinary build path unchanged. Same exec handle 38783 observed live then explicit exit0; no restart on polling yields.

Screenshots: assets/build-awaiting-confirmation.png, build-pending-after-f5.png, build-pending-over-70s.png, build-result-after-f5.png saved. Pending-after-F5, over70s and final visually inspected. Test cleanup cancels pending card/stops surviving run on failure; normal successful path leaves preview running. Final build still produces index-BWlm4q-R.js and index-DDzjYeyO.css.

This supplies the real Devin outer-client timeout acceptance missing from QA28 for this exact current setup, complementing the local MCP protocol test; it does not retroactively prove earlier runs or full release. Original goal still active for remaining settings/native/lifecycle/source closure.
