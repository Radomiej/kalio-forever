# QA164 — real Devin preview recovery and QA shutdown diagnosis

2026-10-04, fixed QA :5288/:3316, HomeSite :57868. Real Devin SWE-2, approved session W4fggLSunrJB41C24MV7C, E:/Projekty/home-site. Static authenticated catalog/profile/tool-policy readiness passed before execution.

PASS: Chromium live preview recovery 1 passed (15.0s). Exact npm run preview -- --host 127.0.0.1 --port 57868 --strictPort approved through Kalio UI. Zero process.cmd.invocation before confirmation and exactly one after; one terminal_spawn; all tools limited to terminal_spawn/terminal_output. Response persisted after F5, with no Stop/connection indicator. Site rendered an H1; HTTP200 independently confirmed for API health, QA UI, and HomeSite. Screenshots: assets/preview-approval.png, preview-response-after-f5.png, home-site.png (site screenshot visually inspected).

## QA162 stopped processes: system restart evidence

Windows LastBootUpTime: 2026-10-04 10:24:31 local. System events: User32 1074 at 10:23:58 (shutdown initiated), EventLog 6006 at 10:24:08 (event service stopped), EventLog 6005 at 10:24:38 (started). Prior HomeSite terminal exited at 10:24:03 with 1073807364. Together these establish a system restart during loss of the previous QA processes; no application crash is established by this incident. The initiating actor/reason was not read or inferred.

Current QA backend PID31936 and frontend PID10328 were created at 10:39:12, parent launcher31288. Both respond. No autostart/service-policy change was made. Process shutdown on computer restart is distinct from CMD spam; this run proves bounded audited command execution, not an OS-wide process trace for every possible workflow.

Remaining scope: source-only neutral provider interruption message needs deployment; large prior dirty runtime changes need ownership review and commits; full acceptance audit remains open. Preserve configured providers and do not reset QA data just to repeat this proof.
