# QA 435 — cancelled terminal observation through real Devin

Date: 2026-10-05 Europe/Warsaw. Starting HEAD aa18f72e, branch codex/kalio-provider-runtime-ux. Only six task-owned API source/test files changed; existing foreign chat, graph, image and other work was preserved. Browser: Codex in-app browser, desktop viewport. Fixed QA API http://127.0.0.1:3316/api and UI http://localhost:5288/. Data: AppData/Local/kalio-forever-qa, not DEV or production.

## Change and local gates

TerminalOutputTool now passes the already existing ToolCallRequest.abortSignal into TerminalService.observeUntilExit. Aborting the observer rejects with AbortError, removes its timer and close/error/abort listeners, and does not kill the underlying background process. Native ToolDispatchService checks cancellation after execution resolves or rejects, so an aborted turn cannot publish a late successful result. This does not roll back previously performed mutations or add cancellation support to external MCP callTool implementations.

The first regression run failed as expected: two service observations remained pending, and two native dispatch cases returned success/error instead of cancelled. After the fix, 111 tests passed in the first three-file check. Final five-file focused check passed 145/145, including native runtime and MCP bridge suites. Four service cases cover abort-before/after subscription, actual TerminalOutputTool forwarding, and normal-completion listener cleanup; OS spawn is mocked in those tests, while service and tool behavior is real.

- API typecheck: exit 0.
- API build: exit 0, 683 SWC files, zero TSC issues.
- Full node scripts/run-test-gate.mjs: exit 0; API 276 files PASS / one skipped, 2978 tests PASS / three skipped; web 215 files and 1889 tests PASS; launcher wrapper 14/14 PASS. Verbose early output was truncated; final counts and command exit were observed. This is not the full browser E2E suite.
- pnpm test:e2e -- tests/regression-stop-follow-up.spec.ts --workers=1: exit 0, Chromium 1/1 PASS on fresh mock data/playwright-stack/1791156934258-29916, random API/UI 59311/59310. It proves UI Stop/follow-up, not Devin or terminal cancellation. Its frontend build includes the pre-existing workspace changes; those are not claimed as authored or committed by this slice. Shared dist/runtime-config.js was restored to fixed QA origins after build.

## Deployment and preservation

Before restart, no active chat runs were found, and a local ignored SQLite backup was made at .tmp/qa-provider-backup/qa-before-435.db (7,110,656 bytes). Ordered credential/app-setting/embedding-credential/execution-profile digests matched afterwards (1/4/0/21 rows). No secrets or database contents are included here.

Both monitors ready at 2026-10-04T23:33:58.862Z, before launcher PID 9748. Restart exited 0 with empty stderr; new backend PID 33756 / UI PID 59424, both HTTP 200. Launcher default remains mock, forceEnvLlm false; this live session explicitly selects Devin ACP SWE-2, not that fallback. dev-servers inventory was read-only; kalio-forever DEV is registered without autostart, fixed QA is run by the documented launcher.

## Real UI test

Immediately before execution, exact-session static readiness passed 17/17: swe-2, kalio_strict, approved E:/Projekty/home-site, six Kalio tools, manual write/spawn approval, native filesystem/terminal disabled. This is configuration evidence, not a new vendor-pricing verification.

One UI request spawned ping -n 21 127.0.0.1 after one reviewed manual approval. Stop was clicked at 2026-10-04T23:37:26.879Z during terminal_output(waitMs=30000). The UI promptly showed cancelled for that tool and Interrupted for the turn. Reload restored both states. Later, after the process naturally finished and QA 436 completed, scoped message history still contained exactly one result for the cancelled output call, with status cancelled, not success.

Session W4fggLSunrJB41C24MV7C; turn jYVSKL8wkEbNo2qXXtsCW; output call mcp-4d700de0-c4da-4ce4-ae1a-480f59fc80e1-2; terminal u2cMpKqj2nyMCicK50Vql. Current-run endpoint returned HTTP 200 with empty body. Screenshots: assets/01-ping-approval.png, 02-after-stop.png, 03-after-reload.png.

| AC | Requirement | Status | Proof / remaining |
| --- | --- | --- | --- |
| STOP-01 | Abort terminal observation promptly | PASS in local and real QA | service regressions, UI cancelled before ping completion |
| STOP-02 | No late successful output after Stop | PASS for this native tool | exactly one persisted cancelled result after natural process exit |
| STOP-03 | Observer does not kill independent background process | PASS | regression no kill; later terminal_list reports ping naturally exited |
| STOP-04 | Durable cancelled UI on reload | PASS | screenshot 03 and scoped messages |
| STOP-05 | Follow-up works and Home Site remains usable | PASS for QA 436 | real build/preview and grouped graph; separate report |
| QA-01 | Preserve providers | PASS | pre/post ordered digests, local backup |
| WIN-04 | No visible startup flashes | UNVERIFIED | see below |

## Startup observer boundary

1295 process samples, maximum gap 45.9597ms; six launcher PowerShell children, two old-stack taskkill commands, four direct backend CLI discovery cmd processes plus CLI descendants. The 40-second window monitor recorded 22 unclassified events; one recovered PID matched launcher PowerShell 44784. Class and visibility were unavailable. Other PIDs are not attributed merely because their timestamps overlap. A concurrent GET-only Devin readiness check also launched Devin probe processes during the measurement. Therefore this is not an isolated restart-only benchmark and does not close the user's short-window report.

Both monitors exited 0 with empty stderr. [P2] Visible-console ownership and launch-path attribution remain required before closing WIN-04. No production proof, full external-MCP Stop guarantee, Codex live recheck, Jev goal-loop acceptance or overall project completion is claimed.
