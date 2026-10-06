# QA483 — passive idle window-event observation

2026-10-06 12:23:30.4997342–12:23:50.5055216 UTC.
Command: scripts/watch-console-windows.ps1 -Seconds 20, exit 0.
No QA/Devin restart, status endpoint request, agent prompt or service mutation.

Eight events were recorded, all unclassified OBJECT_DESTROY (32769).
Five event-thread lookups identified powershell.exe:
52140, 53804, 71328, 56444, 68600. Three had unavailable PID/process identity.
Events occurred within the first three seconds of this observation.

| Requirement | Status | Evidence / boundary |
| --- | --- | --- |
| Event monitor runs and captures transient activity | PASS scoped | eight destroy callbacks, exit 0 |
| Activity requires QA restart or Devin chat | Not supported for captured activity | neither action occurred during observation |
| Visible console flashes reproduced | UNVERIFIED | class and visibility unavailable for all eight |
| Exact parent/callsite identified | UNVERIFIED | no synchronized process snapshot in this run |
| Console defect fixed | NOT DONE | no implementation changes |

Do not equate unknown window destruction with visible console display, or
attribute these new PIDs to the previously identified parent without correlation.
The monitor's own launch is part of the measurement environment. Next useful
proof needs concurrent process-parent capture and window SHOW/class retention.
