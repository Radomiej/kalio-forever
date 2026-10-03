# QA87 — recovery and delayed terminal observation (in progress)

2026-10-03. Prior QA runtime unavailable: API connection refused, previous launcher54497 handle absent, canonical status partial/stale, fixed ports3316/5288/57868 not listening. Last backend log had no fatal stack trace; termination cause unproven. Do not attribute it to Devin or a specific agent without evidence.

Recovered with canonical stop of stale state and Start-Process Hidden running start-qa.ps1 -SkipBuild independently of the transient tool handle. No autostart registration, database deletion or provider update. Launcher3252 verified live, backend9252/frontend53396, same AppData QA DB/workspaces. Static Devin preflight16/16 PASS.

Secondary Markdown agent01a10140-01e8-7061-8f7f-ef8efedd8b84 failed before startup: workspace routing discovery timeout. No worker patches received. Browser MCP inventory empty and IAB unavailable. Using authorized repository Playwright UI test as fallback; no direct tool execution API.

Delayed-process test scope: one approved Kalio terminal_spawn, Node marker after12s, cwd HomeSite, no file reads/writes. One terminal_output waitMs30000 must return raw terminal exit0/marker in same turn. This supplements actual HomeSite build evidence, does not replace generated-project acceptance. Screenshots requested before approval and after completion.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| AC-01 | PASS (recovery) | runtime/state/port checks, live hidden launcher, preflight16/16 | cause of prior termination unresolved |
| AC-02 | PASS (real SWE-2) | Playwright actual UI flow 1/1 PASS, raw exit0/marker, waitMs30000; scoped audit terminal_output duration11245ms | negative/cancel/stop cases separate |
| AC-03 | PASS | UI restore test1/1 PASS in7.1s; QA5288 and preview57868 HTTP200 | preview lifespan remains tied to API |
| AC-04 | UNVERIFIED | Markdown agent failed before work | source regression/fix remains open |

## Delayed-process proof

UI-created actual turn `Q57-blwmxfsyXKbI7zRi0`, model swe-2, terminal `MYn7XvEKyRQixyo40n6iD`. A single manually confirmed Node process outputs QA87_SLOW_OK after12s. One terminal_output call uses waitMs30000, returns exited/exitCode0/marker in same turn. Scoped audit: spawn call1791033281416, CMD invocation1791033281634, spawn result1791033281643, output call1791033282724, output result1791033293969 (duration11245ms), turn completed1791033295311. No second spawn or output required. This is actual live waiting, not a pre-exited snapshot.

Test passed1/1 in22.6s. Approval and completed screenshots saved and inspected; both tools labelled Kalio and composer idle. Follow-up local audit required escalation because sandbox socket access was blocked; unsandboxed read succeeded. Launcher3252/API9252/UI53396 were independently verified alive after the test. OS-wide absence of short-lived CMD windows is not claimed; this audit shows one correlated approved command, not an OS process census.

Preview recovery through the same UI/HITL flow passed separately1/1 in7.1s. Both approval and raw running-output screenshots saved. Final HTTP checks QA5288/preview57868 returned200. No autostart enabled. Terminal-completion capability is verified on deployed QA; entire goal remains open for model catalog, native-policy/stop/queue/negative cases, Markdown parity, and broader scoped commit cleanup.
