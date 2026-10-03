# QA run 81 — real Devin approval after >60 seconds and F5

2026-10-03. Fixed QA UI http://localhost:5288/, API3316, existing approved HomeSite session W4fggLSunrJB41C24MV7C. Provider/model: Devin CLI ACP / exact swe-2. No mock inference. Preserving host reset followed by 16/16 static readiness. Provider credentials unchanged; native filesystem/web/terminal disabled, Kalio bridge enabled, individual terminal confirmation retained.

| Requirement | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Durable long HITL | PASS | Run8_Rxx7iPFeROAQSJxmCYj, turnDW-PJ25JMSG_n2O72Ymqz; waiting_for_human timestamp1791016144887; same run still waiting08:30:15UTC; approval/resume event1791016240356, about95.47s later | No evidence for arbitrary multi-hour waits |
| F5 while pending | PASS | UI reload after >70s restored Confirm; Toggle args showed same npm, args=[run], cwdE:/Projekty/home-site | Screenshot of pending phase not captured |
| Manual approval and actual command | PASS | One UI Confirm, terminalhMydJ3m9MvtGURhE7KDwK; raw terminal_output expanded: statusexited, exitCode0, npm available scripts output | This command only lists scripts, not a new build |
| Actual Devin final response | PASS | Normal Wynik heading/table/output, Kalio terminal_spawn and terminal_output provenance; runtime completed timestamps1791016243390/92; no current run | Full lifecycle twins still open |
| Finished chat recovery / thinking | PASS | Live fixed-QA browser audit320/390/820 with F5: no Stop, no responding, no pulsing/loading Thinking, no horizontal overflow;1PASS3.9s, screenshotsassets | Physical devices and all graph/canvas twins not tested |
| No native declarations | PASS (declaration boundary) | Audit providerToolCount0; strict persona six Kalio tools and native policy unchanged | Complete native-hook isolation and startup CMD monitoring still open |
| No CMD spam | UNVERIFIED in this run | No ownership/event monitor spanning actual initialization and approval | Do not substitute earlier idle samples for this boundary |

Command executed through Devin → Kalio → individually confirmed terminal_spawn: npm with args=[run], cwdE:/Projekty/home-site. No filesystem writes, build, preview/deploy/commit, web or other MCP requested. Raw output: dev→vite, build→vite build, preview→vite preview. One terminal_output observed; final answer agrees with tool result.

Browser command: system Node outside sandbox, KALIO_PLAYWRIGHT_SKIP_BUILD=1, fixed QA/report81; node apps/e2e/scripts/run-playwright-with-stack.mjs qa-home-site-chat-live-audit.spec.ts --workers=1. Disposable helper API59767/UI59766, fixed QA remained5288/3316. Startup output truncated; final PASS and runner exit0 checked separately. No network interception or new source edits in this run. Local source gates remain QA78 evidence, not rerun here.

This closes the specific >60s approval/F5/resume/final acceptance gap. It does not close all Devin communication gates, ChatGPT/Codex validation, remaining existing source commits or the entire project goal. Next priority remains Devin startup/tool-policy/CMD proof, then real ChatGPT/Codex. DEV for iterative changes; preserve provider settings and keep verified QA available for user.
