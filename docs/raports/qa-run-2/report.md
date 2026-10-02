# QA run 2 — stable QA with local Devin SWE-2

Date: 2026-09-26  
Verdict: NO-GO for the requested React-site acceptance. One real `swe-2-high` Devin ACP turn completed, but its first read-only Kalio MCP request was auto-declined; no project files were generated, built, or previewed.

## Scope and safety

- Kalio checkout: `C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever`; the worktree already contained many unrelated user changes. Nothing was reset, stashed, staged, or committed.
- Stable QA: UI `http://localhost:5288/`, API `http://127.0.0.1:3316/api`; profile `%LOCALAPPDATA%/kalio-forever-qa` (previously resolved to `C:/Users/Radomiej/AppData/Local/kalio-forever-qa`). The separate random-port tab at `127.0.0.1:58773` was not used.
- Selected project: `Home Site`, UI root `E:/Projekty/home-site`. The current run could not verify folder contents because the initial `fs_list` did not reach Kalio's tool dispatcher.
- Browser: Codex in-app browser, 1280×720. One user-authorized local Devin run only; no paid Kalio provider was activated. Kalio LLM settings remained `mock/mock`, source `env`.
- Pre-run Devin check: CLI `3000.11.1`, logged in, ACP available, 634 dynamic models; exact `swe-2-high` was marked Free. The chat runtime visibly reported `Devin CLI · swe-2-high`.
- The local MCP bridge token was already configured and was not displayed, rotated, or regenerated. The persona selected six Kalio tools; Devin-native filesystem, web, and terminal remained disabled. Individual approval for `fs_write` and `terminal_spawn` was not granted because no such Kalio call was reached.

## Acceptance matrix

| Requirement | Status | Evidence / remaining |
|---|---|---|
| Correct fixed QA profile | PASS | `localhost:5288` rendered Kalio; backend audit and runtime events were available on `127.0.0.1:3316`. |
| Free model and requested provider | PASS | Catalog check showed `[Free] swe-2-high`; the run used Devin CLI ACP. Kalio's own LLM provider stayed `mock/mock` from `env`; no paid provider was enabled. |
| Real Devin run through Kalio UI | PASS, limited | Session `zOrPQ7EweybA3uFCdQN2o`; one ACP turn ran from 12:02:23 to 12:02:32 and returned text. This proves model execution, not project completion. |
| Bridge configuration | PASS | `devin-cli-acp.mcp_bridge`: `enabled=true`, `requested=true`, `transport=stdio`, `toolCount=6`; native filesystem/web/terminal all `false`. |
| First project listing via Kalio MCP | FAIL | Three `devin-cli-acp.native_approval` records declined requests. The first recorded `toolCallName=null`, title `Calling fs_list from kalio-runtime`, decision `decline`; there was no corresponding `devin-cli-acp.mcp_approval`. The project listing did not run. |
| Attribute decline to a user click | FAIL / unsupported | Devin's text claimed the user rejected the call three times, but the audit has policy-decline records and no matching user HITL decision. Treat the model narration as inaccurate, not as user action. |
| Local API regression gates | PASS | Full `kalio-api` suite: 250 test files / 2720 tests passed; focused ACP/native-tool tests: 11/11; API typecheck passed; API build compiled 638 files with 0 issues. The stable QA process was not rebuilt or restarted, so this source fix is not live there yet. |
| Write/build/desktop-mobile preview/F5 | BLOCKED | No Kalio `fs_write` or `terminal_spawn` ran; no output was produced, so the generated site could not be built or previewed. |
| Save this run's screenshots | BLOCKED | CUA displayed the live graph/audit views but did not expose a file path. A Playwright file capture did not complete and produced no asset; `assets/` contains no screenshot. Run 1 images were not reused. |
| Recheck prior `cmd.exe` burst | NOT TESTED | This run did not collect a bounded before/after `cmd.exe` sample, so it cannot attribute the earlier burst. No unknown process was terminated. |

## Diagnosis and local regression fix

The audit separates configuration from execution: the bridge was enabled with six tools and all Devin-native categories off, but ACP permission metadata omitted the tool name. Kalio's `isKalioMcpToolCall` required `name === 'mcp_call_tool'`, so the request titled `Calling fs_list from kalio-runtime` did not enter the scoped MCP-approval path and was declined. The audit payload does not retain the request's raw input, so the exact `server`/`tool` fields still need confirmation on a future authorized run.

In the source worktree, the matcher now accepts an omitted ACP name only when the structured input exactly matches the configured Kalio server and allowlisted tool, and the title exactly matches that same server/tool. A conflicting name, server, tool, mismatched title, or title without structured input remains rejected. This is not yet active in the stable QA build and has not been verified against a second real Devin session.

TDD evidence: the new helper and ACP-stream regression tests failed before the implementation change; after the change, the focused tests passed 11/11. The full API suite then passed 250 files / 2720 tests, followed by API typecheck and build (638 files, 0 issues). These checks used system Node outside the sandbox because sandboxed pnpm could not read workspace junctions. No real Devin session was used for code verification.

The check `KALIO_API_BASE_URL=http://127.0.0.1:3316/api node scripts/agentflow-paid-readiness.mjs --static-only` was red: Kalio provider `mock`, config source `env`, no saved live credentials, and no active credential. The user explicitly authorized this single free local Devin ACP canary without switching Kalio to a paid provider. That authorization is consumed; it does not authorize another Devin run.

## Screenshot and process evidence

The graph showed `Last run 0 calls · 1 llm` / `Tools: 0`; the separate audit showed the ACP tool attempts and auto-declines. Both views were inspected live in the 1280×720 in-app browser, but no image file was saved. The attempted Playwright capture created no screenshot, and the exact capture process was no longer present on the bounded follow-up check. No `cmd.exe` before/after sample was taken.

## Prioritized next steps

- [P1] Obtain fresh authorization for one more Devin ACP run after rebuilding/restarting stable QA with this source change. Keep `swe-2-high`, the same project, the same six-tool allowlist, and native tools off; inspect a real `mcp_approval` and confirm `fs_list` executes before any write.
- [P1] Do not accept generated-site QA until a Kalio-scoped write and separately approved terminal build complete, followed by desktop/mobile browser verification.
- [P2] Persist audit and execution-graph screenshots into this report's `assets/` directory on the next capture attempt; no screenshot artifact exists for run 2.
- [P2] If the earlier `cmd.exe` burst remains a concern, run one bounded, read-only before/after sample tied to a specifically authorized task; do not infer ownership from process names or terminate unknown processes.
