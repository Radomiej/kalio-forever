# QA305 — transient startup consoles still reported

Date: 2026-10-04. User reports four or five console windows appearing briefly during startup. This is a correction to the existing no-console-spam acceptance criterion, not a new feature request.

The existing `measure-qa-cmd-starts.ps1` observes only cmd.exe during HTTP status requests, not a cold startup. Its previous event subscription failed. PID snapshots and `windowsHide: true` in parent launch options do not prove absence of transient descendant windows.

Retried the broader event-based monitor outside the sandbox:

```powershell
.\scripts\measure-qa-process-starts.ps1 -RootProcessId 41336 -DurationSeconds 5 -Mode events
```

Result: exit 1, `Register-CimIndicationEvent: Access denied`. Subscription failed before MONITOR_READY; no process-start evidence was collected. This is not a zero-start result. No QA restart, provider change, prompt, process termination or target-project modification was performed.

Structural source inspection confirms the general CLI probe now passes `windowsHide: true`; this establishes configuration only, not the origin or disappearance of the reported flashes.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Capture short-lived process starts | BLOCKED | OS event subscription denied | Obtain permitted event tracing before exercising startup |
| Attribute windows to their launcher | UNVERIFIED | No event records | Correlate process time, PID, parent PID and Kalio audit source |
| No visible windows during cold startup | UNVERIFIED | User still reports flashes | Controlled startup with event tracing and visual observation |
| Preserve user QA settings | PASS | No restart or data mutation | Keep provider configuration intact in further tests |

[P2] Do not close the console-window issue on status polling or source options alone. Required next proof: event capture armed before startup, followed by separate recheck and first-message phases. Process creation and visible-window creation are distinct evidence boundaries.
