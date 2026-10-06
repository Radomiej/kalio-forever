# QA473 — central managed-service status query fan-out

2026-10-06. Read-only follow-up to QA472; no status endpoint execution,
restart, service stop, configuration write or source edit outside Kalio.

Source trace in E:/Projekty/mcp-dev-servers:

- REST GET /api/managed-services calls manager.listManagedServices.
- processManager.ts:204 delegates to managedServices.listManagedServices.
- managedServiceManager.ts:78–86 runs refreshProcessTree for every running service
  in Promise.all. Each refresh invokes getProcessTree -> listWindowsProcesses.
- listWindowsProcesses starts powershell.exe and Get-CimInstance Win32_Process,
  retrieving the complete process list separately for each service.
- collectCommand already sets windowsHide:true. No shared snapshot or in-flight
  deduplication exists in the inspected list path.
- local UI App.tsx:130 auto-refreshes every 5000ms when enabled. Source alone
  does not prove this UI is currently open or generating the captured requests.

With N running services, one list request creates N separate full process queries.
This is source-proven fan-out; it is not a measured invocation count for the current
runtime and not proof of visible console windows. QA472 linked 16 sampled processes
to this repository's pre-existing Node process, but exact invocation tracing remains.

| Finding | Priority | Status |
| --- | --- | --- |
| Full process query repeated per running service per status request | P2 | confirmed source behavior, fix not implemented |
| Source of user-visible console flashes | P2 | UNVERIFIED; hiding already enabled |
| Change ownership outside Kalio writable root | P2 | awaiting explicit user scope choice |

Proposed bounded fix: one process snapshot per list batch, shared in-flight reads
across simultaneous status requests, and fresh uncached reads for destructive
stop/kill operations. A cache must not weaken process identity/termination safety.
Acceptance: N running services produce one snapshot per batch, simultaneous lists
share one query, failure clears in-flight state, and stop retains fresh process-tree
proof. Do not replace this with longer UI sleeps or disable status entirely.

An asynchronous scope question was sent to the user. Unrelated Kalio work can
continue while awaiting it; no all-goal blocked condition is claimed.
