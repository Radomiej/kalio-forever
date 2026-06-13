# 2026-06-13 CLI child status and auth failures

## Scope

- Fixed delegated CLI status handling so parent conversation UI no longer treats the spawn/message tool result itself as proof that the child CLI session already completed.
- Added semantic auth/login failure normalization for supported CLI agents so login-required output is recorded as a failure even when the external process exits `0`.
- Kept the fix surgical: no public `@kalio/types` status widening and no unrelated chat UI refactor.

## What changed

- Backend semantic outcome normalization:
  - [`cli-agent-outcome.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/cli-agent/cli-agent-outcome.ts) now centralizes CLI auth/login-required detection and produces an internal `CLIAgentRunResult` with `rawExitCode`, semantic `outcome`, and optional `failureCode`. Detection is scoped to the first auth/error lines instead of regexing the entire output blob, which avoids false positives from successful summaries/diffs that merely mention login commands.
  - [`cli-agent.service.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/cli-agent/cli-agent.service.ts) now returns semantic CLI outcomes for both spawn-based agents and Codex PTY runs while preserving the raw exit code for logs/debugging.
  - [`run-cli-agent.tool.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/tool/tools/run-cli-agent.tool.ts) now persists and surfaces success only when the semantic outcome is completed and the normalized exit path is still zero, and it throws `CLI_AGENT_AUTH_REQUIRED` instead of collapsing auth failures into a generic `CLI_AGENT_FAILED`.
  - [`cli-agent-session-runtime.service.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/cli-agent/cli-agent-session-runtime.service.ts) now finalizes child snapshots/tool results from the semantic outcome, emits `CLI_AGENT_AUTH_REQUIRED` on auth-classified failures, and persists `rawExitCode` / `failureCode` / terminal tool-result metadata into the durable child snapshot payload for reconnect/reload.
  - [`tool-dispatch.service.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/tool-dispatch.service.ts) now preserves explicit tool error codes thrown by the CLI wrapper instead of rewriting everything to `TOOL_EXECUTION_FAILED`.
- Durable CLI-child replay:
  - [`llm-turn-runtime.service.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/llm-turn-runtime.service.ts) now serializes CLI-child `tool_result` history with terminal metadata (`toolResultStatus`, error code/message) so persisted parent-session replay keeps the same terminal state that live socket events already had.
- Frontend delegated CLI status precedence:
  - [`ToolCallBubble.parsers.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/ToolCallBubble.parsers.ts) now extracts persisted terminal tool-result metadata alongside CLI snapshots/results.
  - [`cliChildProjection.model.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/cliChildProjection.model.ts) now owns the shared precedence helper used to interpret embedded child snapshots, live projections, tool activity, and terminal tool results, including persisted terminal status metadata from history reloads.
  - [`AgentTurnBubble.tsx`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/AgentTurnBubble.tsx) now keeps delegated CLI calls in the live/spinner path while the child is still running and only falls back to history rendering after the child actually settles, even after reload.
  - [`CLIChildConversationCard.hooks.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/CLIChildConversationCard.hooks.ts), [`useChatSocketEvents.cliChild.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/hooks/useChatSocketEvents.cliChild.ts), [`executionGraphModel.helpers.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/graph/executionGraphModel.helpers.ts), and [`executionGraphModel.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/graph/executionGraphModel.ts) now share that canonical interpretation so conversation, CLI child cards, and graph/sidebar converge on the same child state.
- Regression coverage:
  - Backend regressions live in [`cli-agent.service.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/cli-agent/cli-agent.service.spec.ts), [`run-cli-agent.tool.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/tool/tools/run-cli-agent.tool.spec.ts), [`cli-agent-session-runtime.service.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/cli-agent/cli-agent-session-runtime.service.spec.ts), and [`architecture-cli-child-status.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/architecture/architecture-cli-child-status.spec.ts).
  - Frontend regressions live in [`cliChildProjection.model.test.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/cliChildProjection.model.test.ts), [`AgentTurnBubble.test.tsx`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/AgentTurnBubble.test.tsx), [`executionGraphModel.helpers.test.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/graph/executionGraphModel.helpers.test.ts), and [`useChatSocketEvents.cliChild.test.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/hooks/useChatSocketEvents.cliChild.test.ts).

## Verification

- Backend focused regressions passed:
  - `apps/kalio-api> .\node_modules\.bin\vitest.cmd run src/modules/cli-agent/cli-agent.service.spec.ts src/modules/tool/tools/run-cli-agent.tool.spec.ts src/modules/cli-agent/cli-agent-session-runtime.service.spec.ts`
  - Result: `3` files, `66` tests passed.
- Frontend focused regressions passed:
  - `apps/kalio-web> .\node_modules\.bin\vitest.cmd run src/features/chat/cliChildProjection.model.test.ts src/features/chat/AgentTurnBubble.test.tsx src/features/chat/graph/executionGraphModel.helpers.test.ts src/features/chat/hooks/useChatSocketEvents.cliChild.test.ts src/features/chat/hooks/useChatSessionActivation.test.ts`
  - Result: `5` files, `70` tests passed.
- Affected app gates passed:
  - `corepack pnpm --filter kalio-web run typecheck`
  - `corepack pnpm --filter kalio-web run build`
  - `corepack pnpm --filter kalio-api run typecheck`
  - `corepack pnpm --filter kalio-api run build`

## Live-readiness

- Delegated CLI work now stays visibly live in the parent conversation until the child session itself leaves `running` / `pending`.
- Login-required Claude/Copilot/Codex/Gemini CLI runs are no longer misclassified as success when the process returns `0` but the output clearly indicates authentication is required.
- Persisted parent-session replay now preserves terminal CLI-child outcomes instead of collapsing cancelled/failed children back into stale running/live state after reload.
- Architecture/runtime completion helpers still treat only completed/success/exited child states as resolved proof; auth-classified failed children remain unresolved.

## Remaining risks

- Auth detection is still regex-based and intentionally scoped to the currently supported CLI agents. New vendor login prompt variants will need follow-up patterns if their wording changes.
- `kalio-web` production build still emits the pre-existing large chunk warning; this fix did not change bundling strategy.
