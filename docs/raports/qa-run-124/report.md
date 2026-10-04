# QA124 — Chrome inspection and Devin preflight

2026-10-04, fixed QA UI http://localhost:5288/, API http://127.0.0.1:3316/api. Existing dirty worktree preserved.

Chrome user-flow: Home → Talk → Home Site → current New Chat. Rendered header shows Devin CLI · swe-2 and E:/Projekty/home-site. Session W4fggLSunrJB41C24MV7C displays Completed, enabled empty composer and no Stop button. Latest persisted preview response contains Kalio terminal_spawn/terminal_output and terminal bfGnvKYJTmBjYIZnrSMMH. These are historical hydrated results, not a new live run.

Current session-specific static readiness: 15/16 checks PASS. Exact SWE-2 strict profile, workspace/persona/six tools, manual HITL, local bridge, native filesystem/terminal denial and refreshed authenticated model catalog PASS. Current run absent and children absent. Host absence check FAIL: status endpoint reports one online swe-2 host, epoch HPLxNwPLOW34eptlDNKkF.

The status response exposes no active-turn/idle field in this host entry. An online host alone does not establish activity or a leak. No prompt sent, host reset, settings change or data deletion. Need inspect registry lifecycle/ownership before either resetting this host or accepting safe reuse; do not weaken the gate based only on the open session being idle.

Screenshots were not saved in this run. Chrome accessibility evidence exists in tool output only. Overall Devin end-to-end closure remains UNVERIFIED.
