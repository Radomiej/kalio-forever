# QA403 — real cold Devin host, persisted conversation

2026-10-04. Fixed QA localhost:5288 / 127.0.0.1:3316/api, worktree 5a7e baseline d1413cb1 plus unrelated changes preserved. Session W4fggLSunrJB41C24MV7C, explicit strict Devin ACP swe-2, exact approved E:/Projekty/home-site. IAB tab 6, no viewport override. No QA restart, token change, write or terminal command.

## Correct readiness mode

Source inspection shows `--resume-session` means warm-host readiness, not merely a persisted conversation. Existing cold-start mode without that flag checks zero hosts while retaining exact session/profile/project, manual HITL, six-tool policy and fresh catalog checks. It passed 17/17 before this UI action. QA402 failure was a mismatched invocation, not a missing cold-start implementation. No gate was changed or bypassed. Added that lesson to AGENTS.md.

Sent QA403_COLD via Chat message / Send message. New turn Ysa7vs2e6IaISyqt-N7-Y started 1791150115465 (21:41:55.465Z), resumed its persisted ACP session at 1791150117005, completed 1791150121056 (21:42:01.056Z). One fs_read call mcp-c4e32532-d7cf-4a34-927b-ac47530345f4-1, successful result 1791150119401. Final UI shows QA403_RESULT, name nexora-home-site and scripts.build vite build; source label Kalio, exact package.json path. The build script value is not a newly executed build.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Cold host with persisted thread | PASS live | Zero-host preflight followed by ACP session.resumed + completed | Other failure/recovery paths separate |
| Approved Kalio read | PASS live | One fs_read success and rendered Kalio source | No native-runtime-wide claim |
| Final/F5 hydration | PASS UI | QA403_RESULT after reload, Stop count 0 | This scenario only |
| Startup window capture | PASS interval, attribution UNVERIFIED | READY 21:41:36.1820169Z / FINISHED 21:42:21.1917866Z surrounds complete run | 8 unclassified events; no PID/class/visibility attribution |

Unknown events were delivered at 21:41:39.9912920Z (CREATE/DESTROY), 21:42:03.9075046Z (CREATE/DESTROY), 21:42:04.0323988Z (DESTROY), 21:42:07.2287636Z (CREATE/DESTROY), 21:42:07.4591926Z (DESTROY). No classified console event. Multiple shell observations ran in this interval. Those timestamps alone neither identify hidden diagnostic processes nor prove absence of user-visible consoles. Eight events do not mean eight windows.

Screenshot [cold Devin after F5](assets/cold-devin-f5.png). No graph-specific interaction or console/network browser log capture in this attempt. No source runtime change or deployment, pricing recheck, external sync, or general console-spam resolution. Host is now started by the successful real task; fixed QA and Home Site preview tabs were preserved. Overall goal remains active.
