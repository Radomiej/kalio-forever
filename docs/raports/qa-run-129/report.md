# QA129 — Ownership of CMD lead

2026-10-04. Read-only six-PID metadata inspection, no new status bursts or generation.

The QA128 new CMD59024 was no longer present. Its previously observed parent11536 is node.exe, created02:43:18 local, parent8380 cmd.exe → parent2472 svchost.exe. Extracted only the script path from its command line, discarding other arguments: C:/Users/Radomiej/AppData/Roaming/npm/node_modules/openclaw/dist/index.js. This identifies OpenClaw as its direct launcher, not a definitive explanation of all flashing windows.

The fixed QA state identifies backend49532 and frontend51112; backend49532 currently exists as node.exe parent56136. Therefore the new CMD parent11536 is not the QA backend. Existing common parent12332 is codex.exe →27248 ChatGPT.exe. These shared processes are outside Kalio target ownership; none terminated or modified.

| Requirement | Status | Evidence / limit |
| --- | --- | --- |
| Attribute QA128 new CMD direct parent | PASS | OpenClaw script path, metadata only |
| Attribute 66 common-parent CMD | PASS scoped | Codex.exe under ChatGPT.exe, individual commands not inspected |
| Prove all flashes removed | OPEN | Short-lived creation not fully captured |
| QA stays available/config retained | UNVERIFIED this run | State and backend process only; no new HTTP health |

Required follow-up: investigate task-owned Kalio launch audit during actual command approval; separately seek authorization before modifying shared OpenClaw/Codex launcher lifecycle. Overall goal remains active.
