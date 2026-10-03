# QA run 64 — bounded process observation during actual SWE-2 read

## Method

Read-only process diagnostic `scripts/measure-qa-process-starts.ps1` records process IDs, parent IDs, names and observation timestamps only. No command lines, environment or credentials. Root must be explicitly supplied and live. The event subscription is cleaned in finally; no startup/service changes.

Windows denied Win32_ProcessStartTrace subscription even outside the sandbox. No privilege/security changes were made. Explicit `-Mode poll` uses CIM snapshots with a 250ms delay between snapshots (actual interval includes CIM latency). This can miss short-lived processes and is not an event-complete trace. PID reuse is not guaranteed safe for attribution; this script never terminates any processes.

## Actual run

- API root 28088: confirmed node.exe / parent 59440 before observation.
- Observation 2026-10-03T06:23:06.3405159Z through 06:23:51.6770258Z, approximately 45 seconds.
- Initial tree 19 processes, including four existing cmd.exe processes. Devin root 36776; existing Home Site preview root 61184. Existing nodes/python/serena/conhost are startup-tree observations, not evidence of native tool invocation.
- Observed new owned processes: 0. Observed new owned CMDs: 0. Observed new CMDs across the snapshot scope: 0.
- During observation, UI started exact SWE-2 turn `ktkx4mfGvoCpKNwCX29Kp`, session `W4fggLSunrJB41C24MV7C`: one Kalio fs_read E:/Projekty/home-site/package.json. UI completed with `nexora-home-site` and the Kalio provenance chip.
- Scoped audit: model swe-2; six Kalio tools and zero provider tool declarations; MCP approval completed; ACP turn completed; llm.turn.completed toolCallCount=1, duration2793ms. Multiple ACP tool progress events are not multiple process starts or duplicate executions.
- No target writes, terminal spawn, paid/model fallback, or native-tool permission changes in this run.

## Verification and limits

- PowerShell parser PASS. Polling mode ran and completed exit0.
- Positive control PASS: disposable Node root23004 created child61980 after30seconds; polling observed that exact node.exe with parent23004 plus conhost8092 beneath it. Control and monitor both exited0; no API/Devin child was created by the control. An earlier disposable control completed before useful start observation and was not counted as this proof. All controls exited naturally.
- [P2] This bounded sample does not prove no intermittent CMD spam, host-start bursts, reset races, or very short-lived processes. Event-complete measurement remains unavailable under current Windows privileges.
- [P2] Existing Devin startup children (including Serena) need separate configuration attribution before claiming their tools were invoked or blocked; process presence alone is insufficient.
