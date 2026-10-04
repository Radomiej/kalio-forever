# QA295 — CLI task launch hiding and corrected typecheck boundary

2026-10-04. Local API source/tests, not a fixed-QA deployment.

Added windowsHide=true to the generic CLIAgentService spawn path (file remains below 500 lines). Added regression assertion to the command-shim execution test, preserving cwd and session/turn/call audit assertions. No permission, argument, stream, timeout or cancellation behavior changed.

System Node outside sandbox: two focused spec files, 27/27 tests passed, terminal exit0. Includes startup/first-list coalescing, probe serialization/cache, command-shim audit, stop and error cleanup. Probe regression previously RED in QA294; task assertion added with the task patch and has no separate RED evidence.

API tsc --noEmit outside sandbox exited0. The earlier sandboxed typecheck failure in QA294 is not a valid release blocker once this authoritative outside-sandbox run passes.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Probe/task hide option | PASS | 27 focused unit tests | OS-level startup/window observation |
| API types/build | PASS | Outside-sandbox system Node tsc exit0; Nest build exit0, 0 issues, 680 files compiled | Deploy boundary |
| Fixed QA | UNVERIFIED | No restart or deploy | Preserve provider settings and deploy after build |
| User console flashes | UNVERIFIED | No successful event capture | Do not claim all windows eliminated |

Scope excludes intentional PTY execution and consoles launched by external descendants. Overall goal active.
