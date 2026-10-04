# QA284 — Stop reaches subagent request owner

Date: 2026-10-04, Europe/Warsaw. Isolated built Playwright stack, API port 62593. Chromium, one worker. Local HTTP/SSE provider through the real adapter; not a live Devin/Jev test. Fixed QA was not restarted or reset.

## Cause and change

Architecture roles execute through `SubagentRuntimeService`, not the ordinary chat pipeline. The socket Stop path omitted `SubagentRuntimePort.stopAndDrainSessions`, so cancelling the workflow record and draining pipelines did not abort role requests. QA283 still had one pending HTTP stream after 20 seconds.

Gateway now delegates cancellation orchestration to `ChatGatewayRuntime`: architecture, AgentFlow, subagents, CLI and pipelines start cancellation before awaiting all drains. The existing subagent registry aborts matching controllers by child/parent/history/VFS session ownership. Terminal snapshots remain after drain. No public contract, provider settings or target project files changed.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| STOP-01 | PASS | Regression RED: zero subagent cancellations while architecture drain pending; GREEN: invoked once with session tree | REST stop sibling remains sequential; review separately |
| STOP-02 | PASS | 52 backend tests; API typecheck and build exit 0, 680 files compiled | Full workflow release gate not rerun |
| STOP-03 | PASS | Three Chromium tests passed in 4.6s; fixture observed active HTTP stream before Stop and zero afterwards | This attempt used existing force-click helper |
| STOP-04 | PASS | Run sdu6i8BkEfZQ5ZYm4XZ9w cancelled/user_stop; host HMzFOhUZpib3gRkKyCdkD; one socket Stop frame; no pending/queue/Stop UI | F5 strengthened in QA285 |
| STOP-05 | UNVERIFIED | No fixed QA deployment or real agent rerun in this attempt | Required before claiming live integration closure |

Commands: focused gateway/session-stop Vitest; API tsc --noEmit and Nest build; `node scripts/run-playwright-with-stack.mjs workflow-stop-runtime.spec.ts ac-21-session-title.spec.ts --project=chromium --workers=1 --reporter=line` from apps/e2e with system Node, outside sandbox, skip-build after fresh API build.

Verdict: isolated socket workflow cancellation passes; live/fixed-QA and complete release remain unverified.
