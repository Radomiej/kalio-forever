# QA run 59 — settings reset EBUSY and owned process teardown

Date: 2026-10-03. Actual fixed QA: UI `http://localhost:5288/`, API `http://localhost:3316/`, AppData QA data retained. API PID 28088, frontend PID 34392; launcher 59440. Backend log: `.tmp/qa-stack-logs/backend-1791006214475-59440.log`.

## Reproduced defect

Turning Web off through Agent runtimes returned `Internal server error`; checkbox remained checked. Backend recorded `EBUSY` deleting the host's ephemeral workspace. A subsequent settings GET showed Web already false and hostCount=0: persistence succeeded, teardown failed, UI was stale. Do not re-enable Web to compensate for this partial failure.

## Change

- Kill only the owned live Devin process tree on Windows, with hidden direct `taskkill.exe /PID <captured PID> /T /F` invocation.
- Wait for termination command and direct-child close before deleting its cwd. Deadline failures remain errors.
- Coalesce concurrent close/reset requests; fence registry acquisition and stale closed-host startup.
- Keep failed cleanup/config and failed registry entries for retry; wait for all reset operations to settle.
- Use bounded Node rm retries for transient Windows locks after the process barrier.
- No public/shared schema, native permissions, target-project files, approval policy or foreign work changed.

## Acceptance matrix

| AC / PIT | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| AC-01 / PIT-34: cleanup ordering and recovery | PASS | Three regressions RED before initial patch; final focused suite 25/25 PASS. Failed cleanup retained; failed registry host retained. | Additional concurrency tests were first observed green, not claimed RED. |
| AC-02 / PIT-37: reset concurrency | PASS for covered paths | Shared close promise, registry acquisition waits for reset, stale closed-host start rejected. | Deferred config/initialize races and overlapping settings PATCH ordering not independently exercised. |
| AC-03 / PIT-36: Windows tree ownership | PASS for live-root case | Real disposable Node root/child tree stopped; unrelated sentinel survived; owned config removed. | Parent-exits-first and PID reuse boundary not proven. |
| AC-04 / PIT-04: deployed artifact | PASS | Backend tsc --noEmit exit 0; Nest build 0 issues, SWC 667 files; authorized fixed QA restart reused built dist. | Not production proof. |
| AC-05 / PIT-07: actual save/reset | PASS | After real idle SWE-2 fs_read, PATCH {web:false} returned HTTP 200; GET hostCount=0. All 14 pre-recorded Devin/descendant PIDs absent afterward. | Post-fix save used API to avoid temporarily broadening native permissions; original failure was reproduced through UI. |
| AC-06 / PIT-18: resumed conversation | PASS | Session W4fggLSunrJB41C24MV7C; pre-reset turn 6u46Sv488xhcODN2UINdC, post-reset MT4q44J8bnmVnRLeSqzyf. Both swe-2, MCP fs_read, toolCallCount=1, completion events. | Writes/builds were not repeated in this run. |
| AC-07 / PIT-11: UI truth and F5 | PASS for successful reset | Agent runtimes shows filesystem/web/terminal unchecked; conversation answer `vite build`, Kalio chip restored after F5, no Pending/Stop. | UI reconciliation after persistent reset failure remains an open recovery improvement. |
| AC-08: absence of CMD spam | Limited evidence | Two CMDs before this idle reset; recorded old tree entirely gone after reset. | Not continuous monitoring; cannot exclude transient bursts elsewhere. |
| AC-09: screenshot artifact | UNVERIFIED | In-app browser accessibility observations recorded. | No durable screenshot file created for this actual run. QA57 fixture screenshot is not this run. |

Test command: from `apps/kalio-api`, system Node on PATH, outside sandbox:

```text
node node_modules/vitest/vitest.mjs run src/modules/agent-runtime/devin-cli-acp.shutdown.spec.ts src/modules/agent-runtime/devin-cli-acp.host.spec.ts src/modules/agent-runtime/devin-cli-config.spec.ts src/modules/agent-runtime/devin-cli-integration.controller.spec.ts src/modules/agent-runtime/devin-cli-acp.llm-source.spec.ts --maxWorkers=1
```

An initial default-worker run aborted with V8 `Fatal process out of memory: Zone`; it was not counted as verification. The bounded single-worker runs passed.

Verdict: actual idle save/reset/resume defect corrected and QA-proven. Entire Home Site / original UX task remains in progress. P2 before production: exercise uncovered startup/PATCH races, parent-exits-first, persistent-error UI reconciliation, and close the broader acceptance matrix. No native tools were enabled and no target-project writes performed.
