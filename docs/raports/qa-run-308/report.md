# QA308 — fresh Home Site build through real Devin SWE-2

2026-10-04. Fixed QA UI localhost:5288, API3316. Session W4fggLSunrJB41C24MV7C, exact model swe-2, project E:/Projekty/home-site. GET-only readiness passed 17 checks before execution. In-app browser tabs9 and8.

Sent a UI prompt asking for one Kalio terminal_spawn with command npm, args [run,build], cwd E:/Projekty/home-site, followed by terminal_output. Inspected the full confirmation payload and confirmed once. Native tools, writes, install and commits excluded.

Final UI report: terminal kLAi62CJJswLqcgtrdKza exited, exit code0. Vite5.4.21 transformed26modules and built in3.37seconds. Assets: index-DDzjYeyO.css and index-BWlm4q-R.js. UI showed both tools as Kalio.

Scoped audit from1791133228308:27rows, exactly one terminal_spawn and one terminal_output call with matching results; HITL requested and confirmed once, one process.cmd.invocation, devin-cli-acp.turn.completed and llm.turn.completed. No command retry observed. One invocation does not prove absence of visible consoles or native descendant processes.

Reloaded existing preview at127.0.0.1:57868 after the build and saved rendered screenshot. Reloaded QA: QA308_DEVIN_BUILD_RESULT visible, Stop agent absent. No manual target source edits or direct target terminal execution.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Real SWE-2 bridge build | PASS | UI approval, call/result audit and exit0 | Full stability/lifecycle gates remain |
| Manual command authorization | PASS | Exact cwd/command/args inspected; confirmed once | Broader approval recovery tests remain |
| Durable final response | PASS | F5 heading visible and no Stop | Other lifecycle states not retested |
| Rendered fresh Home Site | PASS | Refreshed preview and screenshot | This run is not a complete design/accessibility audit |
| CMD windows eliminated | UNVERIFIED | OS event tracing denied inQA305 | Startup tracing and visual capture still required |

Demo boundaries: NEXORA and references/contact data are fictional; contact form is explicitly demo-only and does not send messages. Build success is not production business acceptance.

Artifacts: devin-build-after-refresh.png, home-site-fresh-build.png. Providers and QA data preserved. Overall goal remains active.
