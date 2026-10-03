# QA86 — terminal completion observation (in progress)

2026-10-03. Scope: fix QA85's premature final response while HomeSite build was still running. Shared dirty worktree preserved. QA not restarted or redeployed in this attempt yet.

Root cause: terminal_output offered only an immediate snapshot. Existing waitForExit kills the process on timeout and cannot safely implement a read-only observation tool.

Change: optional terminal_output.waitMs, integer 0–30000, default immediate snapshot. New observeUntilExit listens for close/error with a bounded timeout; timeout returns current running/null-exit snapshot without killing or starting any process. Listeners and timer are removed after observation. Metadata instructs builds/tests to observe completion and never infer success from running status. Existing destructive tool confirmation unchanged; no shared types or native permissions changed.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| AC-01 | PASS (unit) | fail-first explicit-wait test failed before implementation; final expanded suite 79/79 passed | actual tool schema/runtime |
| AC-02 | PASS (unit) | close/error/timeout tests verify snapshots, listener/timer cleanup, no kill and no additional spawn | real process through Devin |
| AC-03 | PASS (QA deployment) | canonical stop, previous launcher terminal exit 0, start-qa -SkipBuild; API tool schema exposes waitMs | DEV real observation still pending |
| AC-04 | PASS (bounded SWE-2 run) | turn 2a51eSOHq6Mhx-o70Lecf completed build in one turn with terminal_output waitMs=30000 | actual slow-process wait and unaided metadata selection remain unproven |

No HomeSite source edits, provider credential changes, or QA data reset. Actual approved target build performed by Devin through Kalio, not directly by Codex. One-turn completion is proven for the explicit waitMs prompt, not for every unaided prompt.

Focused ESLint passed after changing the observation timer to const. Both backend builds passed typecheck (0 issues), 674 files compiled. Final regression suite 79/79 PASS. Test cases cover negative/oversized/fractional/string/null/NaN/infinite waitMs; ordinary immediate snapshots preserve their existing output shape.

## Actual deployment and run

- Exact prior managed fixed QA verified: backend 55964, frontend 66004, AppData kalio-forever-qa/kalio-qa.db. HomeSite no current run. Canonical stop; old launcher handle23130 observed exit0 before new launch.
- New canonical start-qa.ps1 -SkipBuild: backend24472, frontend31044, live launcher54497. Same DB and workspace root; no data deletion or provider update. Global direct provider remains mock, but explicit HomeSite runtime is real Devin ACP swe-2/kalio_strict. Static preflight all16 PASS.
- GET /api/tools confirms terminal_output.waitMs integer0–30000 in the running backend schema.
- Through QA UI, fully reviewed and manually confirmed npm args [run,build], cwd E:/Projekty/home-site. Turn `2a51eSOHq6Mhx-o70Lecf` completed. Expanded actual tool arguments contain id `2C1O3H-AajRwF0g6jKXki`, waitMs30000. Final response reports exited, exitCode0, Vite5.4.21, 26 modules,467ms; no follow-up or second spawn needed. Tools labelled Kalio, ordinary composer returned without Stop.
- Timing: tool_output completed in approximately1ms, because this small build exited before the read. This proves the new parameter travels through Devin/MCP/Kalio and returns final output, but not live waiting on a still-running process. Event-driven waiting/timeout/no-kill proof remains unit-level in this attempt.
- Restart stopped the API-owned HomeSite preview; restored through Devin/terminal_spawn/HITL, terminal `fP52w-zcOdTHZrKzxGyYI`, running on 127.0.0.1:57868. Existing provider settings retained. QA UI itself responds HTTP200.
- Actual preview and completed Devin chat browser suite: 3/3 PASS (6.3s), including 320/390/1440 site layout, keyboard/menu/form/reduced-motion tests, and 320/390/820 chat F5 with no running indicator. Nine screenshots saved in this attempt's assets folder. No complete-goal claim: catalog selector and additional negative/slow/stop/queue/native-policy cases remain open.
- P3 observed in inspected completed-real-chat-390.png after F5: intermediate prose before the tool and final Markdown heading join as `output (bez waitMs).## Podgląd uruchomiony`, so that heading is not rendered as a heading. Completion state and both Kalio tool badges remain correct. Persisted/streamed paragraph-boundary parity needs a regression; this suite does not assert it.
