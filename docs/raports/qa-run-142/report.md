# QA142 — CMD launcher review and terminal visibility regression

Fixed QA status census window 1791084392371–1791084393619: 40 cached status GETs, CMD count 109→109, no new surviving process. Does not capture short-lived processes.

New scripts/measure-qa-cmd-starts.ps1 attempts Win32_ProcessStartTrace subscription, cleans subscriptions in finally and outputs metadata only. Actual invocation failed with Access denied before requests; event-based process evidence is BLOCKED by Windows permissions. Do not present it as a clean measurement.

Confirmed source defect: TerminalService.spawn used shell:true on Windows without windowsHide, unlike inspected Devin/Codex hosts/probes. Added windowsHide:true. Fail-first regression: 1 failed/24 passed, showing omitted spawn option; after minimal fix 25 passed. Mock process tests prove spawn options and single invocation, not OS window visibility or absence of bursts.

No HITL policy/tool permission changes. Product fix is local and not rebuilt/deployed in this slice. QA remains on QA141 backend. Exact source finding does not explain hundreds of consoles; earlier ownership evidence pointed at separate Codex/OpenClaw processes, not all QA activity.

Next: affected backend typecheck/build, controlled QA deploy, approved terminal run and scoped audit; OS-wide short-lived process trace requires privileged capture or an equivalent available observer. Do not kill external processes to mask the symptom.
