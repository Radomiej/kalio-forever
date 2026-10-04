# QA187 — actual ChatGPT/Codex HomeSite read

2026-10-04. Fixed QA UI http://localhost:5288/, API :3316, AppData kalio-forever-qa; backend QA167/frontend QA186 index-D-HWRbLa.js. Checkout C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, branch codex/kalio-provider-runtime-ux, pre-test HEAD d740af89 plus preserved mixed dirty work. Chromium 1280x720. No restart, deploy, provider mutation, write or target-project commit in this run.

Real ChatGPT-backed Codex gpt-6-luna, session yvD83rgDA_ZHvUwJKlo_S, strict profile codex-local-1bd82ba45243e8a3a0c4aa0478538f67, auth chatgpt-default. Model catalog recheck then static profile readiness passed before UI action: exact enabled model, online host, fresh epoch-matching catalog, approved E:/Projekty/home-site, no unresolved runs/children, configured external MCP inheritance disabled, six Kalio tools and manual write/spawn HITL.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Real Codex tool communication | PASS | UI prompt, exactly one fs_read call and durable result containing nexora-home-site and vite build | Other Codex tools separately scoped |
| Correct project read | PASS | Actual package.json result for approved HomeSite | No file mutation tested |
| Tool provenance and F5 | PASS | Final answer retained, one Kalio label, no Stop | Other consumers/live reasoning separately scoped |
| CMD boundary | PASS for scoped window | Zero process.cmd.invocation; only fs_read tool call | Not OS-wide console trace or full native execution inventory |

Playwright qa-codex-project-read-live.spec.ts: 1 passed (9.5s), actual test 8.7s. Marker QA187_CODEX_READ_1791107469085, turn u_n4TG4duuGRZXn6FgtLL. Screenshot assets/codex-project-read-after-f5.png saved and visually inspected: real returned name/build script, Codex model header and successful Kalio fs_read card.

This extends prior no-tool Codex reply/follow-up evidence to actual Kalio tooling on the current QA frontend. It does not prove all ChatGPT lifecycle/approval/native categories or close the whole requested goal. No mock used for this explicit session, and no plaintext credential printed/exported.
