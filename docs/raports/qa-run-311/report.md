# QA311 — isolated Stop/follow-up regression

2026-10-04. Ran existing regression-stop-follow-up.spec.ts through the isolated Playwright stack with system Node, Chromium, one worker, KALIO_PLAYWRIGHT_SKIP_BUILD=1. API49938, UI49937, control49940; database directory data/playwright-stack/1791133648662-59320. Fixed user QA3316/5288 not restarted.

Result: 1 PASS, 2.3seconds, runner exit0. Test starts a controlled mock stream in an existing explicitly mock-profiled conversation, clicks Stop, checks Stop hidden, sends follow-up, checks a new active turn, two additional user messages and no queued badge. Fixture was already modified before this run; no edits made to it here. Test deletes its isolated session in finally.

Inspected fixed-QA dist/runtime-config.js after the run: apiUrl and wsUrl still http://127.0.0.1:3316. This is configuration evidence, not an independent live health probe.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Stop then fresh follow-up | PASS in isolated mock | Browser assertions, runner exit0 | Real Devin lifecycle not covered by this mock |
| No queued follow-up | PASS in isolated mock | chat-queued-badge absent | Full reconnect/child workflow remains |
| Fixed QA isolation | PASS for test configuration | Dist origin3316; isolated DB/ports | No current Windows visual-startup proof |

No screenshots captured by this passing test. Reused built artifacts, so this is not a fresh source build gate. Original broad E2E failures remain unreconciled; do not infer full-suite success from this result.
