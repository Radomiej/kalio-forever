# QA333 — event-based console-window diagnostic

2026-10-04. No QA restart, provider changes or Home Site writes.

Added `scripts/watch-console-windows.ps1`: bounded Win32 window event hook (create/destroy/show/hide), message pump, hook cleanup in finally. Records UTC timestamp, owning PID, numeric event and window class only. Excludes titles, command arguments and secrets. Targets classic console and Windows Terminal window classes.

Executed outside sandbox with `-Seconds 2`: hook registered successfully, finished normally, zero records. This proves registration/cleanup, **not** event delivery for a visible window and **not** elimination of startup flashes. Unlike the CIM process-start method, registration did not return Access denied.

Added two source regression tests for bounded lifecycle/cleanup and privacy/no process mutation. Next gate: run capture during a controlled QA/Devin startup and correlate captured window PIDs with process ownership. Console host ownership may differ from the CLI PID; do not infer causality without correlation. Hidden-console descendants or differently classed windows can remain outside this diagnostic's coverage.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Register alternative event capture | PASS | Real Win32 registration and normal 2-second termination |
| Capture user-reported flash | UNVERIFIED | No controlled startup in this attempt |
| Eliminate flash | UNVERIFIED | No runtime launch fix claimed |
