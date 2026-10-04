# QA335 — direct Devin version probe and event-delivery self-test

2026-10-04. Read-only Devin probe, no QA reset/provider changes/Home Site writes.

With the 25-second console window hook ready, system Node called the resolved vendor executable with `--version`, `windowsHide: true`, 15-second timeout. Parent PID 41400, child 55456; result `devin 3000.11.1 (cc4e349ca55e)`, success in 27 ms. Capture ended normally with zero console-class records. This isolates only the version probe, not MCP discovery or ACP startup.

Added `-SelfTest` to the diagnostic: creates a one-pixel native Static control without WS_VISIBLE, destroys it in finally, and fails if no event arrives. Real self-test passed: 2026-10-04T18:10:34.8121127+00:00, PID 56348, event 32768 (OBJECT_CREATE), class Static, one record, exit 0. This validates callback delivery on the current desktop, not completeness for every console/window class or descendant attribution.

| Acceptance | Status | Evidence / remaining |
| --- | --- | --- |
| Actual Devin version probe | PASS | Vendor executable, success, 27 ms |
| Window hook event delivery | PASS | Invisible control OBJECT_CREATE captured |
| Console flash eliminated for cold QA/ACP start | UNVERIFIED | Neither cold full-stack nor ACP startup captured |

Two source regression tests cover bounded lifecycle, hook/control cleanup, and privacy/no process mutation. No model request, native agent tool or provider credential action occurred.
