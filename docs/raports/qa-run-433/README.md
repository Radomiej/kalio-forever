# QA 433 — optimized startup, console flashes unresolved

Date: 2026-10-05 Europe/Warsaw. Launcher revision: aa18f72e. Fixed QA: API 3316, UI 5288, AppData kalio-forever-qa. Backend/frontend built artifacts unchanged.

Both observers were armed before the authorized restart, at 2026-10-04T23:17:58.487Z. Launcher PID 1008 exited 0. New API PID 50804 and UI PID 57396 returned HTTP 200. Provider settings were backed up locally before restart; ordered digests of credentials, app settings, embedding credentials and execution profiles matched afterwards. No credentials are included in this report.

Process sampling captured 1293 samples, maximum gap 47.0907ms. The launcher created six PowerShell children, compared with ten in QA 431. Two taskkill invocations stopped the previous stack. Backend initialization also launched four CLI discovery commands: Copilot, Gemini, Claude and Codex. These are process observations, not evidence that any particular process displayed a visible console.

The window hook recorded eleven unclassified events. Seven recovered a PID; one matched launcher PowerShell PID 58788. Four had no recoverable PID. Neither the console class nor visibility was established. Therefore the user's report of four or five briefly visible windows remains unresolved. Do not interpret zero classified console events as proof of no flashes.

Cold Devin preflight passed 17/17. A real SWE-2 UI run restored Home Site preview using manually approved Kalio terminal_spawn and terminal_output. Terminal w8uPeAUb86GOogSt_ghSL was reported running. Screenshots: assets/01-approval.png and assets/02-result.png. No target source files were edited in this run.

| Area | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Reduced launcher process churn | PASS for measured restart | six versus ten PowerShell children | not equivalent to removal of visible windows |
| QA provider preservation | PASS | before/after configuration digests | no portable encrypted export claimed |
| Real Devin preview recovery | PASS for tool execution | UI approval and result screenshots | independent refreshed preview capture not included |
| No visible startup windows | UNVERIFIED | unclassified window events and user report | identify visible window owner before declaring fixed |

[P2] Required before closing the console issue: correlate a briefly visible window with its owner and launch path. QA remains available at http://localhost:5288/.
