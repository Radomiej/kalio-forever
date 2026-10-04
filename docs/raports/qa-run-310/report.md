# QA310 — Devin probe/model queue regression coverage

2026-10-04. No QA restart, live prompt or configuration change. Structural scan of API spawn sites and focused inspection of remaining child_process imports: inspected direct production launches specify windowsHide; probe/model callers also pass it into the Devin command queue. This source inspection does not establish absence of descendant console windows.

Added two isolated queue tests: concurrent probe/model submissions start only one execFile until it finishes; timeout/maxBuffer/hidden options are preserved; a failed probe does not poison the queue or trigger retries. Combined queue and model-catalog run: 4 PASS, 2 files. The requested probe.service.spec.ts filter did not match a file and is not counted as tested.

Initial test harness incorrectly expected Node execFile's specialized promisification return shape from a plain callback mock. Removed those irrelevant result-shape expectations; this was a fixture correction, not a reproduced product failure. Tests cover sequencing and launch options, not real CLI outputs or OS windows. Production code unchanged.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Serial probe/model process launches | PASS locally | Concurrent queue regression | Live cold startup attribution remains unverified |
| Queue recovery without retries | PASS locally | Failed first request then successful next | OS-level process events unavailable |
| Hidden parent launch options | PASS for inspected source/test scope | Spawn scan, caller options and queue assertions | External CLI descendants not proven |
| Eliminate visible flashes | UNVERIFIED | No visual/startup capture | Do not claim fixed from these unit tests |

API typecheck with system Node outside sandbox exited0. No runtime deploy is required for test-only changes. Goal remains active.
