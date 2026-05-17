# 2026-05-17 10:00 - CLI agent live validation on mcp-youtube

## What was done

- Live-tested Kalio at http://localhost:5188 against the real project directory `C:\Projekty\mcp-youtube` using the shared browser page and Playwright browser tools.
- Verified runtime allowed paths include `C:\Projekty`, so the target repo is covered by the CLI workdir guard.
- Reproduced a direct `Fullstack Dev -> run_cli_agent` flow with `agentId: copilot` and `workdir: C:\Projekty\mcp-youtube`.
- Reproduced an orchestrated `Orchestrator -> run_subagent -> child run_cli_agent` flow against the same repo.

## Findings

- Direct `run_cli_agent` flow works end-to-end and returned a successful top-level listing for `C:\Projekty\mcp-youtube`.
- Child `run_cli_agent` approval renders centrally in the master conversation under `run_subagent` and is actionable.
- After confirming the child CLI call, the UI can show `confirmation expired` immediately even though the child CLI run actually continues and eventually returns `exit 0`.
- In the orchestrated path, the parent session can remain in `Thinking` with the composer locked for a long time after child success, then recover much later.
- `Stop agent` did not clear the stuck state immediately during the orchestrated run; the parent later surfaced as interrupted.

## Files touched

- Added this session log only.

## Decisions

- Did not change application code during this session.
- Highest-value follow-up is still the frontend confirmation invalidation handling around `tool:confirmation_invalidated` versus later `tool:start` / `tool:result` for child CLI calls.

## Open questions

- Whether the misleading `confirmation expired` state is purely a frontend status mapping bug or also masks delayed parent loop settlement.
- Whether the long parent lock after child success is caused by run-subagent completion handling, not the CLI adapter itself.

## Next steps

- Add a focused regression test for confirmed child `run_cli_agent` in the master view.
- Trace `tool:confirmation_invalidated` with reason `confirmed` through the frontend activity state machine.

## Follow-up fix

- Added a frontend regression test in `ChatInterface.test.tsx` proving that `tool:confirmation_invalidated` with reason `confirmed` must not downgrade a tool activity to `expired`.
- Updated `ChatInterface.tsx` so `confirmed` clears the pending confirmation and restores the tool activity to `running` until the eventual `tool:result` arrives.
- Validation: targeted Vitest regression passed, then the full `ChatInterface.test.tsx` file passed (`46/46`).