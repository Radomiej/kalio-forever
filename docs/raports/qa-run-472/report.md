# QA472 — correlate unknown startup window events to process owner

2026-10-06. Read-only analysis of QA469 capture; no restart, agent prompt or kill.
Capture: ignored .tmp/startup-captures/capture-1791286854234-61024.json.

Of 17 unique nonzero PIDs recovered from unknown window events, 16 match sampled
powershell.exe children of Node PID 13376. One PID has no sampled match. Window
class and original visibility remain unknown: these are not 16 proven flashes.
The matching children occur around 11:39:28–32 and 11:40:28–32 UTC.

Fresh read-only CIM/Get-Process inspection finds PID 13376 still running, system
Node, started 2026-10-05 19:02:58 local time. Sanitized script-path extraction
identifies tsx preflight/loader under E:/Projekty/mcp-dev-servers/node_modules.
This process predates QA469 backend PID42916 and is not its sampled descendant.
Parent PID6008 was not returned by current CIM; ancestry beyond that is unknown.
No full command line or credentials were retained in this report.

Read-only source inspection of mcp-dev-servers finds Windows process-tree queries
in src/core/managedServiceManager.ts: getProcessTree -> listWindowsProcesses ->
collectCommand(powershell.exe). collectCommand already uses windowsHide:true.
This is a candidate explanation for process churn, not proof that these particular
calls caused visible consoles. Do not remove hiding or blame Devin without proof.

| Requirement | Status | Evidence / next |
| --- | --- | --- |
| Identify sampled owner of unknown events | PASS scoped | 16 exact PID matches, shared parent13376 |
| Confirm owner is QA backend | Contradicted for matched events | parent predates QA; tsx paths belong to mcp-dev-servers |
| Prove visible flashes and exact callsite | UNVERIFIED | need window SHOW/class evidence and sanitized child invocation tracing |
| Fix console defect | NOT DONE | no source or runtime mutations this run |

QA and Home Site remain untouched. Broader goal stays active; this result narrows
the next diagnostic boundary instead of substituting process counts for visibility.
