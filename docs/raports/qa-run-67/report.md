# QA run 67 — deployed import patch, real resume and startup-process sample

## Deployment

- Authorized canonical start-qa.ps1 -SkipBuild -ForceRestart reused gated dist; AppData QA database/workspaces retained. Fixed UI5288 and API3316. New API43912, frontend13992, launcher66120. Launcher handle86400 remains live.
- API local gate before deploy:13 focused tests PASS, tsc PASS, Nest0 issues/SWC668 files. FE uses previously gated built assets.
- Global stack fallback is mock/mock; actual conversation's explicit profile is enabled devin-cli-acp / swe-2 / kalio_strict. Do not equate the stack fallback with this live inference.
- Settings GET: native filesystem/web/terminal allfalse, settings-owned bridge enabled. HITL manual, unattendedFallback pause, externalPolicyEnabled false. No permissions broadened.

## Real browser / audit evidence

- Conversation W4fggLSunrJB41C24MV7C hydrated after restart with completed prior build/reads preserved.
- UI-started turn XBFwbY83L7IogHpLcBwS9 resumed existing Devin conversation on exact swe-2 and read E:/Projekty/home-site/package.json once through Kalio. Actual answer: vite build.
- Scoped audit: devin-cli-acp.session.resumed, six Kalio tools/zero provider declarations, MCP approval completed, ACP completion and llm.turn.completed toolCallCount1. No target write/terminal spawn for this read.

## Startup process observation

Polling window2026-10-03T06:43:13.4027800Z–06:43:58.8521584Z, explicit live API root43912. Baseline only API process.

- New owned processes16, including Devin17820, Serena59356/python descendants and two CMDs (5676 directly under Devin;16004 under its Node48772).
- Four CMDs observed across snapshot scope; two were not attributed to the API tree. No command lines/environment/credentials were read or logged.
- This run contradicts any claim that the editor-import patch removes native Devin global MCP startup. It does not reproduce a burst of dozens/hundreds, nor exclude shorter-lived/missed console activity.
- Process startup is not itself proof of agent tool invocation. Existing Kalio approval guards remain a separate boundary.

## Home Site preview

The old listener53340 and root61184 were absent after the QA restart. One reviewed preview request was approved through separate HITL in the real SWE-2 conversation. Kalio terminal JwSuVV8mIqd2RAJ_7MwV6 reported running, exitCode null and Vite preview at http://127.0.0.1:59857/. No new write/build was requested.

## Post-restart browser gates

- Actual fixed-QA conversation, not a mocked fixture: qa-home-site-chat-live-audit.spec.ts PASS (1/1, 4.8s), runner exited0. F5 at320/390/820 retained exact Devin CLI / swe-2, usable composer, no Stop/responding/pulsing Thinking, hidden session sidebar and no document horizontal overflow. Screens: assets/completed-real-chat-{320,390,820}.png;320 and820 visually inspected.
- Actual Home Site preview59857: home-site-live-audit.spec.ts PASS (2/2, 4.2s). Responsive320/390/1440, keyboard menu/Escape/focus return, demo form validation/retry, reduced motion and intact hero word at320. Runner exited0. Incidental isolated mock stack started by the canonical runner is not real-provider evidence; these tests navigated the explicit actual preview URL.
- [P3] Actual agent prose concatenates a Markdown heading with the preceding sentence (raz.##). Screenshot820 records it; this is an output-format issue, not a remaining active-thinking indicator.

## Remaining

- [P2] Global Devin MCP startup suppression/isolation still required, with process proof and hooks/native-tool boundary checks. No broad security guarantee follows from tool declaration counts.
- [P2] Original full UX acceptance matrix and remaining owned commits/cleanup remain open.
