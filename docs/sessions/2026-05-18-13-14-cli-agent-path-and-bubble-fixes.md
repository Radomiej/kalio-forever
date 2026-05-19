# CLI agent path and bubble fixes

## What was done

- Added a backend regression test for `CLIAgentSessionRuntimeService.continueSession()` to reproduce the `AllowedPaths` bypass on existing CLI child sessions.
- Fixed `CLIAgentSessionRuntimeService` so both `spawnSession()` and `continueSession()` revalidate the target `workdir` through `AllowedPathsService` before running a child turn.
- Updated `CLIAgentModule` to import `AllowedPathsModule` for the new runtime dependency.
- Added frontend regressions for durable CLI session snapshots in `ToolCallBubble`.
- Added a dedicated durable-CLI snapshot parser and rendered those results with a status block instead of falling back to raw JSON in both live and history bubbles.

## Files touched

- `apps/kalio-api/src/modules/cli-agent/cli-agent-session-runtime.service.ts`
- `apps/kalio-api/src/modules/cli-agent/cli-agent.module.ts`
- `apps/kalio-api/src/modules/cli-agent/cli-agent-session-runtime.service.spec.ts`
- `apps/kalio-web/src/features/chat/ToolCallBubble.parsers.ts`
- `apps/kalio-web/src/features/chat/ToolCallBubble.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.test.tsx`
- `apps/kalio-web/src/features/tools/tool.utils.ts`
- `apps/kalio-web/src/features/tools/tool.utils.test.ts`
- `apps/kalio-web/src/store/agentStore.ts`
- `apps/kalio-web/src/store/agentStore.spec.ts`

## Decisions

- Kept the existing `spawn_cli_agent` tool-side `AllowedPaths` validation and added runtime-level validation as the safety boundary so future callers cannot bypass it.
- Introduced a separate UI renderer for durable CLI session snapshots instead of coercing them into `CLIAgentResult`, because running snapshots often do not have an exit code yet.
- Kept the change narrowly scoped to the reviewed regressions; no broader CLI-agent UX refactor was attempted.

## Verification

- `cd apps/kalio-api && npx vitest run src/modules/cli-agent/cli-agent-session-runtime.service.spec.ts`
- `cd apps/kalio-web && npx vitest run src/features/chat/ToolCallBubble.test.tsx`
- `cd apps/kalio-api && npx vitest run src/modules/tool/tools/cli-agent-session.tools.spec.ts`
- `cd apps/kalio-web && npx vitest run src/features/tools/tool.utils.test.ts`
- `cd apps/kalio-web && npx vitest run src/store/agentStore.spec.ts`
- VS Code diagnostics check on all touched files: no errors

## Follow-up note

- Web tool catalog now groups `spawn_cli_agent`, `message_cli_agent`, `get_cli_agent_status`, and `stop_cli_agent` under the `Agent` bucket with the rest of the orchestration tools.
- Canvas auto-open policy now covers all durable CLI session tools in addition to `run_cli_agent` and subagent activity, so child-session state is visible immediately after spawn, follow-up, status checks, and stop actions.