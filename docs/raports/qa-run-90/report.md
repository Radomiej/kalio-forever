# QA90 — real Devin Stop, pending HITL and follow-up

## Environment and authorization

2026-10-03, worktree `C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever`, HEAD at start `4d54246`. Existing unrelated dirty changes preserved. Fixed built QA: UI localhost:5288, API 127.0.0.1:3316; same AppData kalio-forever-qa data. Approved HomeSite session `W4fggLSunrJB41C24MV7C`, project `E:/Projekty/home-site`, explicit Devin ACP profile `devin-local-441b1fa56f117064487b71b4eb1cf33e`, exact swe-2, strict native-off/manual HITL.

Static preflight initially passed 15/16: existing idle Devin host was the only blocker. Current-run endpoint was empty. Per user authorization, reset only that host via settings PATCH `{}`, retaining settings; then all 16 static checks passed before submitting the UI prompt. No QA database reset, credential export or provider change. Previous local gate was green: API 2906, web 1835, launcher 14; frontend typecheck/build passed.

## Real browser workflow

Authorized repository Playwright used actual QA UI, not a mock server or direct LLM/tool API. Test `devin-stop-follow-up-live.spec.ts`: 1 passed, 8.7 seconds. Browser lifecycle managed by Playwright. Desktop screenshot 1280x720.

1. SWE-2 requested one Kalio terminal_spawn with a harmless marker command in HomeSite. UI showed exact arguments and manual confirmation. Never clicked Confirm.
2. Clicked Stop while approval was pending. Stop, Confirm and responding placeholder disappeared.
3. Immediately sent a new prompt permitting exactly one Kalio fs_read of package.json. New turn completed with heading QA90_FOLLOW_UP_RESULT and actual project name nexora-home-site; no queued badge.
4. F5 retained the final response without stale Stop or responding placeholder.

## Durable evidence

- Stopped turn `mwlkJP5x25X7hz7y8dUXL`, user prompt `twk6uA5gd6C8yyY3UPtC2`.
- Confirmation requested 1791037077832; external HITL cancelled 1791037078528. terminal_spawn result cancelled at 1791037078530, call `mcp-39095c71-e481-4f36-912f-31afbee74f22-1`. Persisted result explicitly states cancelled/not approved.
- ACP completion cancelled 1791037078560; llm.turn.cancelled 1791037078561.
- Follow-up turn `BbG2Ww56Ok1cnWNtdLlr7` started 1791037078807, one successful fs_read at 1791037079796, completed 1791037080605. Persisted assistant `mRt2uCw01M9xgalmiq5aW` contains the final heading and project name.
- Both runtime start events show swe-2. Native tool declarations were omitted; ACP MCP permission accept is not human command approval.
- Exact audit window 1791037074478–1791037080605: 37 rows, zero process.cmd.invocation events, zero native approval events, one cancelled terminal_spawn result and one successful fs_read result. Current-run endpoint empty afterwards; QA UI and HomeSite preview both HTTP 200.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Stop while HITL pending | PASS | Real UI plus cancelled durable tool/turn | Stop during active inference is separate |
| Follow-up drain and terminal UI | PASS | New actual fs_read turn starts immediately and completes | Queuing during active work is separate |
| F5 | PASS | Final heading retained, no Stop/responding | Mobile Stop workflow not tested this run |
| No unapproved command execution | PASS | Scoped audit window and cancelled result | Not an OS-wide CMD census |

## Screenshots

- [Unapproved command](assets/pending-unapproved-command.png)
- [Stopped before follow-up](assets/stopped-before-follow-up.png)
- [Completed follow-up after F5](assets/follow-up-completed-after-f5.png)

No generated HomeSite file changes, build, new terminal process or deploy command were authorized by this test. This is real Devin negative-path evidence, not full Devin/ChatGPT integration acceptance, production proof or a pricing claim.
