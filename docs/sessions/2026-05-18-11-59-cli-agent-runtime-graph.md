# 2026-05-18 11:59 - CLI agent runtime graph

## What was done

- Added durable CLI child-session runtime support with background spawn, follow-up messaging, status inspection, and stop handling.
- Registered new tool surface: `spawn_cli_agent`, `message_cli_agent`, `get_cli_agent_status`, `stop_cli_agent`.
- Extended the execution graph to render `cli-agent` child sessions, mark them running from live loop state, and open them from the inspector.
- Preserved CLI child-session identifiers in frontend tool-result parsing.

## Files touched

- `apps/kalio-api/src/modules/cli-agent/cli-agent-session-runtime.service.ts`
- `apps/kalio-api/src/modules/cli-agent/cli-agent.service.ts`
- `apps/kalio-api/src/modules/cli-agent/cli-agent.module.ts`
- `apps/kalio-api/src/modules/tool/tools/cli-agent-session.tools.ts`
- `apps/kalio-api/src/modules/tool/tool.providers.ts`
- `apps/kalio-api/src/modules/tool/tool-registry.service.ts`
- `apps/kalio-api/src/modules/tool/tool-registry.service.spec.ts`
- `apps/kalio-web/src/features/chat/ToolCallBubble.parsers.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.helpers.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphNodePresentation.ts`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphBoard.tsx`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphView.tsx`

## Decisions

- Kept CLI session lifecycle local to `CLIAgentModule` to avoid `ToolModule` ↔ `ChatModule` coupling.
- Reused child-session socket events (`session:created`, `agent:start`, `tool:start`, `tool:result`, `agent:done`) instead of inventing a separate CLI event family.
- Persisted child-session hidden metadata through system messages and reconstructed status from persisted tool results when no live runtime entry exists.
- Kept `run_cli_agent` as the blocking compatibility tool while adding a session-first tool surface for orchestrated flows.

## Validation

- `apps/kalio-api`: `npx vitest run src/modules/tool/tools/cli-agent-session.tools.spec.ts`
- `apps/kalio-api`: `npx vitest run src/modules/tool/tool-registry.service.spec.ts`
- `apps/kalio-api`: `node_modules\\.bin\\tsc.CMD --noEmit`
- `apps/kalio-web`: `npx vitest run src/features/chat/graph/executionGraphModel.test.ts`
- `apps/kalio-web`: `node_modules\\.bin\\tsc.CMD --noEmit`
- `get_errors` on all touched backend/frontend files returned no errors

## Open questions

- The new runtime service composes continuation prompts from recent child-session history, but there is still no dedicated runtime spec covering that prompt assembly end-to-end.
- The graph now renders CLI child sessions, but there is not yet a UI action to send follow-up prompts or stop sessions directly from the graph inspector.

## Next steps

- Add backend runtime-focused tests for `CLIAgentSessionRuntimeService`, especially interrupt/continue semantics and persisted status reconstruction.
- Wire graph/child-session UI controls to `message_cli_agent` and `stop_cli_agent` so monitoring and steering happen directly from the frontend.