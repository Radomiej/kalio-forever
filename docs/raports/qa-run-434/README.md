# QA 434 — Stop during real Devin terminal observation

Date: 2026-10-05 Europe/Warsaw. Existing fixed QA, real Devin SWE-2, exact approved project E:/Projekty/home-site. Warm preflight passed 17/17. No target files were changed.

The user-approved UI request spawned one bounded loopback command: ping -n 21 127.0.0.1. Manual HITL approval was confirmed once. Devin then called Kalio terminal_output with waitMs 30000. Stop was clicked at 2026-10-04T23:22:30.544Z while that observation was active.

The chat subsequently showed Interrupted, no Stop or Confirm controls, and no active current run. However, terminal_output later published the complete ping output with exited status and exit code 0. The underlying ping naturally finished. This does not prove that Stop should kill background terminal sessions; the defect is continued observation and late successful tool completion after cancellation.

Source trace: terminal.tools.ts does not forward the existing request.abortSignal to TerminalService.observeUntilExit. That service subscribes to close/error and a timer, but not cancellation. ToolDispatchService forwards the signal to tools, yet currently maps thrown execution errors to error and returned values to success without checking cancellation after execution. MCP bridge constructs a combined request signal and supplies it to native dispatch. Full owning-turn cancellation propagation still requires regression and live verification.

Screenshots: assets/01-ping-approval.png and assets/02-after-stop.png. Screenshots and the observed tool result establish this failure boundary; no fix or deployed regression proof is claimed.

[P1] Required before treating Stop as reliable: cancel the observation promptly, remove its timer/listeners, publish cancelled rather than late success, and preserve independently running background processes. Add focused regression coverage, then repeat the real Devin UI test after deployment. This issue is separate from unresolved startup console flashes.
