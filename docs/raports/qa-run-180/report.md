# QA180 — real Devin directory and terminal inventory

2026-10-04. Fixed QA UI http://localhost:5288/, API http://127.0.0.1:3316/api, AppData kalio-forever-qa. Checkout C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, branch codex/kalio-provider-runtime-ux, pre-test HEAD b765b312 plus preserved mixed dirty work. Existing backend QA167 and frontend QA175; no deployment/reset/settings change in this attempt. Chromium 1280x720.

Real exact swe-2, session W4fggLSunrJB41C24MV7C, strict Devin ACP with the approved six Kalio tools. Read-only warm preflight passed immediately before UI submission. Approved target E:/Projekty/home-site. Turn mRSUmEyVdY_xpeQCQC7ul, marker QA180_LIST_1791106415252.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Real fs_list | PASS | Exactly one audited call, durable result lists package.json, index.html, src, dist, docs, node_modules and package-lock.json | No recursive listing or permission-denial path tested |
| Real terminal_list | PASS | Exactly one audited call, durable result has existing preview running and previous build exited with code 0 | Listing is not independent OS process verification |
| No new command/write | PASS for audited window | Only fs_list/terminal_list tool calls; zero process.cmd.invocation | Not OS-wide console-spam proof |
| Durable UI and provenance | PASS | F5 retains final answer and two Kalio origin labels; Stop absent | Other workflow consumers still separately scoped |

Command: system Node Playwright, tests/qa-devin-list-tools-live.spec.ts --project=chromium, external fixed QA, KALIO_DEVIN_LIST_TOOLS=1, KALIO_DEVIN_LIST_REPORT_RUN=180. Result: 1 passed (6.6s). No mock provider used for the explicit session. Screenshot [list-tools-after-f5](assets/list-tools-after-f5.png) saved and visually inspected: returned inventory and both successful tool cards visible.

Existing preview terminal RPEG139VWsHxv7t3a2g59 reports running PID 38784 on :57868. Existing build terminal 1wte4ayw6840JfXjPz9wN reports exitCode 0 and built index-BWlm4q-R.js; this is the earlier build result, not a new build performed in QA180. The test requested no writes, native tools, web, process spawning or commits in HomeSite.

Combined with QA170 read, QA172 spawn/output/build and QA179 confirmed write/read, this covers successful use of all six approved Kalio tools across recorded real Devin runs. It does not prove the entire settings UX, all lifecycle/race cases, physical console absence, or full release readiness. Full goal remains active.
