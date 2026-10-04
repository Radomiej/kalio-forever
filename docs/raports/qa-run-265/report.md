# QA265 — tool-intent screenshot before cleanup

2026-10-04, Europe/Warsaw. PASS for the isolated tool-intent case, including reviewed visual evidence.

Capture now occurs after visible `Preparing raapp_create` and the actual confirmation event, but before fixture cleanup. Cleanup still disconnects the observer and deletes only the isolated test session; no tool approval was clicked.

System Node outside sandbox, one worker, existing builds:

`node scripts/run-playwright-with-stack.mjs mock-tool-intent-fallback.spec.ts --project=chromium --workers=1 --reporter=line`

`KALIO_PLAYWRIGHT_SKIP_BUILD=1`; isolated API `60215`. Terminal **1 passed (2.1s), exit 0**, 15:39:22. The screenshot was copied using absolute paths, byte length verified, then visually inspected.

| AC / PIT | Status | Evidence | Remaining |
|---|---|---|---|
| Synthetic tool intent / PIT-07 | PASS | UI Preparing label and confirmation despite absent arg-progress events | Mock no-arg-progress fixture, not native/live Devin |
| Provenance and approval wait / PIT-03 | PASS | Screenshot shows Kalio origin, full args, Confirm/Cancel and explicit waiting state | No tool execution claim |
| Visual proof / PIT-05 | PASS after one artifact correction | Capture precedes cleanup; QA264 rejected capture preserved | Mobile not tested in this case |
| Full browser gate / PIT-01 | FAIL / not rerun | QA257 and focused recovery reports | 19 original failed cases remain unresolved |

No production UI/source change, fixed QA reset/deploy, real-project mutation or new Devin/Codex generation occurred. This restores trustworthy test preparation/evidence; it is not completion of the overall goal.
