# QA332 — transient startup consoles remain unresolved

Date: 2026-10-04. Fixed QA: UI 5288, API 3316.

User reports four or five console windows briefly appearing at startup. This remains an open defect; polling and `windowsHide: true` are not proof of absence.

Read-only inspection, no QA restart or provider changes:

- Managed state identifies backend PID 56760 and frontend PID 59800.
- Backend log records Devin startup on 2026-10-04 at 19:38:34–35: version PID 59552 (29 ms), MCP discovery PID 2264 (409 ms), MCP verification PID 59792 (559 ms), parent PID 56760. Each records `windowsHide=true`.
- These three probes are temporally plausible candidates, not attributed visible windows. Their descendants are not captured by these records.
- Stack manager backend/frontend launches and the shared build runner specify `windowsHide: true`; build callers inherit that setting through `runProcess`.

| Acceptance | Status | Evidence / remaining |
| --- | --- | --- |
| Identify short-lived startup processes | Partial | Three direct Devin probe PIDs recorded; descendants and visible window ownership unverified |
| Eliminate console flashes | UNVERIFIED | User still observes flashes; no new runtime fix claimed |
| Preserve QA providers | PASS for this inspection | No runtime/data mutations performed |

Next required diagnostic: event-based process-start capture including parent PID and window ownership during a controlled startup. Earlier event subscription access failure remains a limitation; do not replace it with an absence claim based on polling. Keep capture free of tokens and command arguments containing credentials.

## Continuation: event capture permission check

Retried a read-only `Register-CimIndicationEvent` subscription to `Win32_ProcessStartTrace` outside the sandbox. Windows returned `Access denied`; no subscription remained registered, and QA was not restarted. This rules out using that capture method with the current process permissions, not the existence of console flashes.

Structural inspection also confirmed `windowsHide: true` on the direct Devin ACP spawn, both Codex process spawns, CLI version probes, and CLI taskkill. These flags cover direct children only; no claim is made about downstream launchers or visible windows.
