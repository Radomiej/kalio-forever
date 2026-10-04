# QA99 — Reset diagnostics deployed after reboot

2026-10-04. Worktree codex/kalio-provider-runtime-ux, starting HEAD3161f02 plus preserved unrelated changes. Previous verification handle was missing after reboot; no Node processes and old compiled artifact confirmed interrupted work. Re-ran verification rather than claiming an unknown result.

## Implementation and local proof

Timeout Error now carries safe shutdownState: terminationComplete, exitCode, signalCode, stdoutClosed and stderrClosed. This distinguishes unresolved tree termination from pending stream close in future logs. No credentials, paths or command lines included. Timeout, process targeting and success conditions unchanged; this is instrumentation, not a root-cause fix.

Two regression tests failed on missing structured diagnostics before the change; three tests passed after it. OS execFile boundary mocked, real shutdown orchestration tested; no real PID termination in those tests. Negative case preserves rejection when taskkill fails despite close notification. API typecheck passed; build zero issues,676files compiled. Focused ESLint exited0. Root pnpm test exited0: API2911passed/3live-skipped, launcher14passed; shared/script/web gates passed. No complete Playwright suite or production proof.

## QA restoration and live boundaries

Restored fixed built QA5288/API3316 using hidden start-qa.ps1 -SkipBuild on the same AppData kalio-forever-qa database. Nineteen execution profiles retained identical digest C4075CD46E25E70A073E8A6579AA4E8248F46C40B9EF17364CE71DDCF792AEB5. This covers profiles, not an independent secret inventory. Launcher43028, API19328, frontend41680. No database reset/deletion.

Static real-Devin gate16/16passed. Actual UI restore requested and manually approved npm preview in E:/Projekty/home-site. Turn oG5g6mCaEkYS4zAKawY_R, terminal Dd51uzNehRl0Dq7HwYaDT, pid13748. Durable terminal results show running with null exitCode; HTTP57868 returned200. The browser test failed its final details assertion: last Toggle details targeted an older build's terminal_output while current UI rendering had not reached the new result. Do not count that test green or repeat the already-successful spawn.

After confirming no current run, one authorized reset PATCH settings{} succeeded520ms, hostCount0. QA5288 and preview57868 both200 afterwards. Original sporadic reset timeout was not reproduced; new diagnostic fields therefore have unit proof, but no observed real failure snapshot yet.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Safe diagnostic state | PASS local | RED/GREEN, typecheck/build/lint/root gate | Real timeout capture still missing |
| QA/profile preservation | PASS | Same DB,19profiles unchanged | No secret export created |
| Single real idle-host reset | PASS | 520ms, hostCount0 | Not proof of permanent fix |
| Preview operational | PASS API/HTTP | Durable running result, HTTP200 | Restore browser test final assertion FAIL |
| Full goal | OPEN | Prior real HomeSite repair/build/queue proof retained | Reset root cause, scoped UI restore, native denial and ChatGPT remain |

Screenshots: [approval](assets/preview-approval.png), [failed final test assertion](assets/preview-test-failed.png). No final-success screenshot claimed.
