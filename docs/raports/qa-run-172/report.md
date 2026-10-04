# QA172 — actual HomeSite build through approved Devin/Kalio terminal

2026-10-04. Fixed QA http://localhost:5288/, API http://127.0.0.1:3316/api, isolated AppData kalio-forever-qa. Checkout C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, branch codex/kalio-provider-runtime-ux, pre-test HEAD 1712712c, existing mixed dirty work preserved. Existing QA167 built deployment; no backend reset or provider configuration changes. Chromium desktop 1280x720.

Exact real Devin swe-2 session W4fggLSunrJB41C24MV7C, strict ACP profile, project E:/Projekty/home-site. Warm static preflight passed immediately before composer-driven UI execution. Only terminal_spawn npm with args [run, build] and exact approved cwd, followed by terminal_output, were requested. No native tools, installation or source edits requested. Build outputs in dist are the intentional project mutation.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Manual confirmation before command | PASS | Exact audited payload inspected before Confirm; zero process.cmd.invocation before confirmation | Other commands/approval surfaces not covered |
| Single build execution | PASS | One terminal_spawn and one process.cmd.invocation after confirmation; all tool calls limited to terminal_spawn/terminal_output | OS-wide console/window trace not collected |
| Actual build, not agent claim | PASS | Durable tool_result contains exitCode 0, vite and built in; screenshot shows exited, vite v5.4.21, 26 transformed modules, built in 1.04s | No broader production gate claimed |
| Reply, tools and F5 | PASS | Scoped current run empty, unique final heading preserved after F5, no reconnect indicator; Kalio origin visible for both tools | Graph/Canvas parity separately pending |

Playwright qa-devin-approved-build-live.spec.ts: 1 passed (9.0s), test 8.2s. Test now has unique marker, numeric report-run parameter, scoped active approval arguments, persisted terminal-result assertions and Stop cleanup. assets/build-awaiting-confirmation.png and build-result-after-f5.png saved and visually inspected.

Generated artifact shown in terminal output: dist/assets/index-BWlm4q-R.js, matching the previously audited preview artifact. This run proves a real approved build of the generated React project through Devin/Kalio, not a direct shell build. Existing lower-level and browser results remain separately scoped in QA169–171. Full objective remains active because remaining integration/settings/UX and lifecycle acceptance is not yet fully proven.
