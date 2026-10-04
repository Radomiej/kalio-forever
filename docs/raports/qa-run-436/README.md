# QA 436 — real Devin follow-up builds and serves Home Site

Date: 2026-10-05 Europe/Warsaw. Fixed QA http://localhost:5288/, API http://127.0.0.1:3316/api, AppData QA data, exact project E:/Projekty/home-site. Same real SWE-2 strict session W4fggLSunrJB41C24MV7C, turn ySoPaNTiGJUULjfOc37bx. No target source files were manually changed or changed by this request. Existing dirty workspace and the image agent's work were preserved.

Warm exact-session static readiness passed 17/17 immediately before the UI request. The request followed the stopped QA 435 turn and did not queue or duplicate prior work. Native filesystem/terminal and arbitrary external MCP remained disabled; the persona exposed only the six approved Kalio tools. Pricing was not independently revalidated.

## Observed execution

1. Reviewed and manually confirmed npm run build, cwd E:/Projekty/home-site.
2. terminal_output(waitMs=30000) returned exited / exitCode 0. Actual build terminal 0UXObeN33oJiS28mBqC_V, PID 40068. Vite 5.4.21 transformed 26 modules and finished in 494ms. Output: dist/index.html 0.62KB, index-DwWIW8Lp.css 11.01KB, index-i3YokrP5.js 154.74KB.
3. terminal_list showed no active preview, only naturally exited ping and build.
4. Reviewed and separately confirmed npm run preview -- --host 127.0.0.1 --port 57868 --strictPort, same cwd.
5. terminal_output returned running for preview DTn2XPlOPTyAf8YcaE8C2, PID 59160. Independent HTTP request to http://127.0.0.1:57868/ returned 200; the existing browser tab was refreshed and displayed NEXORA.

Two UI observation calls expired before the next approval/completion was visible. Each was followed by inspection of the same active turn, not by restarting or resending any command. The original turn completed normally with QA436_RESULT. API persisted five linked tool calls and five results; current-run later returned empty. Graph displayed Turn completed and one five-call Tool group; its inspector showed each call as Kalio / completed. This checks this turn, not every graph architecture state.

## Evidence

- assets/01-build-approval.png
- assets/02-preview-approval.png
- assets/03-build-preview-result.png
- assets/04-home-site.png — freshly loaded browser, desktop viewport
- assets/05-tool-group.png — five grouped tool calls, per-call provenance and state

| Area | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Real Devin follow-up after Stop | PASS | new linked turn, no restart/resubmission | broader long-run lifecycle matrix remains open |
| Target project build | PASS | actual terminal exited 0 and persisted output | not a production deploy |
| Preview recovery without duplicate | PASS | terminal_list, separate approval, running preview and HTTP 200 | preview is local and temporary |
| Chat/graph tool grouping | PASS for this turn | one group, five calls, Kalio/completed inspector | not all workflow variants |
| Generated business site | PASS for rendered demo and build | refreshed NEXORA browser capture | fictional business/contact data and demo form, not a real client production site |
| Startup console flashes | UNVERIFIED | QA 435 monitoring boundary | owner/visible-window attribution |

Final health: API, QA UI and Home Site all HTTP 200. QA and local preview remain running for review. No new Codex or Claude live run occurred in this attempt; no Jev/goal-loop completion is claimed.
