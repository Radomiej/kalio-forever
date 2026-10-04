# QA210 — grouped tool disclosures

Date: 2026-10-04. Target: fixed QA localhost:5288, API 127.0.0.1:3316. Existing Codex session yvD83rgDA_ZHvUwJKlo_S; no new prompt, tool execution, fixture or backend reset.

## Change and evidence

ExecutionGraphInspector now uses native details/summary per grouped tool. Arguments and results retain full text in keyboard-focusable bounded scrolling regions. Missing results say `No result recorded`; status and whole-group raw developer view remain available. No new nodes or shared contracts.

- RED: focused new assertion failed because the tool row had no disclosure, 12:51:17, exit 1.
- GREEN: all 24 inspector unit tests PASS, 12:52:13; frontend typecheck exit 0. Existing AgentFlow act warning remains.
- Frontend build PASS, 3118 modules, 5.08s. Served build generated index-Aw4BUbQ4.js and index-_PPxa1nv.css; QA runtime config restored to API/WS 127.0.0.1:3316. This build includes other pre-existing dirty frontend changes; not a clean committed release claim.
- In-app browser confirmed the real saved Codex build group exposes npm/run/build arguments, home-site cwd, persisted terminal id/pid/command and terminal-output details without Show raw.
- Opt-in Chromium read-only regression: 1 PASS, 3.3s. Selects exact existing Codex session, opens both tool disclosures, saves screenshot, reloads and reopens the group; arguments survive and Stop is absent.
- Screenshot: assets/codex-group-details.jpg, visually inspected.

| AC / PIT | Status | Evidence | Remaining |
|---|---|---|---|
| Grouped detail discovery / PIT-18 | PASS, Codex saved history | Real arguments/result regions, no raw view needed | Real Devin history and pending approval parity |
| F5 / PIT-03 | PASS, selected Codex history | Read-only browser regression | Stop/queue/active approval not tested here |
| Compact grouping / PIT-02 | UNVERIFIED | No additional nodes introduced by disclosure | Zoom still changes grouping; not corrected here |
| Runtime identity / PIT-07 | UNVERIFIED | Model is gpt-6-luna; persona remains named Devin SWE-2 QA | Clarify persona versus runtime/provider labels |

The in-app tab briefly showed connection/recovery banners during initial navigation; a later graph snapshot no longer showed them. No new model run was attempted, and this is not proof of socket send readiness. Actual Chromium regression passed with the existing session.

No Jev run, AutoApprove change, account pricing check, provider reset or backend deployment was performed. The overall goal remains open.
