# 2026-05-18 09:53 - Gemini CLI timeout/liveness

## What was done

- Reproduced the Kalio UI issue where `run_cli_agent` with Gemini appeared to stay in `running...` after Gemini had already emitted error output.
- Added a backend regression test for CLI processes that emit `exit` but never deliver `close` promptly.
- Updated `CLIAgentService` to fall back from `close` to `exit` after a short grace period so CLI runs do not hang forever on lingering stdio handles.
- Probed Gemini CLI directly on Windows and confirmed that missing approval flags blocked shell/file actions.
- Added `--approval-mode yolo` to the Gemini adapter defaults and covered it with a regression test.
- Re-tested through the live Kalio UI using MCP Playwright.

## Files touched

- `apps/kalio-api/src/modules/cli-agent/cli-agent.service.ts`
- `apps/kalio-api/src/modules/cli-agent/cli-agent.service.spec.ts`
- `apps/kalio-api/src/modules/cli-agent/adapters/gemini.adapter.ts`
- `apps/kalio-api/src/modules/cli-agent/adapters/gemini.adapter.spec.ts`
- `docs/cli-agent-module-architecture.md`

## Decisions

- Kept the outer Kalio confirmation as the only human approval step, then enabled Gemini `--approval-mode yolo` inside the CLI run so the agent can actually execute shell/file tools non-interactively.
- Used an `exit` fallback in `CLIAgentService` instead of resolving immediately on `exit`, preserving a short grace window for the normal `close` path.

## Validation

- `cd apps/kalio-api; npx vitest run src/modules/cli-agent/cli-agent.service.spec.ts`
- `cd apps/kalio-api; npx vitest run src/modules/cli-agent/adapters/gemini.adapter.spec.ts`
- `cd apps/kalio-api; npx vitest run src/modules/cli-agent/cli-agent.service.spec.ts src/modules/cli-agent/adapters/gemini.adapter.spec.ts src/modules/cli-agent/adapters/codex.adapter.spec.ts`
- MCP Playwright UI smoke after the fix:
  - Orchestrator -> `run_cli_agent(gemini)` -> confirm
  - final UI result returned to the chat
  - `npm --version` surfaced as `11.11.0`

## Findings / open questions

- Gemini CLI on Windows can emit a `node-pty` `AttachConsole failed` stack trace while still completing successfully and returning useful output.
- Broader Orchestrator tasks can still choose too-short `timeoutMs` values (observed `120000ms`) and retry after timeout. That is a separate orchestration/runtime-policy issue from the CLI liveness fix.

## Next steps

- If long Gemini runs still feel flaky in orchestrated flows, inspect why the parent model keeps choosing `timeoutMs=120000` and whether the tool prompt or timeout policy should discourage that.