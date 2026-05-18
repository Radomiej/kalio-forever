# CLI Agent Child Sessions

## What was done

- Added the first session-backed CLI slice: `run_cli_agent` now creates a persisted `cli-agent` child session before launching the CLI process.
- Added `CLIAgentSessionService` in `CLIAgentModule` to create the child session and persist the prompt plus final `tool_result` transcript directly through `DrizzleService`.
- Extended shared session contracts and DB session kind typing to include `cli-agent`.
- Updated the Conversations sidebar so `cli-agent` child sessions render with child indentation and a dedicated badge.
- Added focused tests for the backend tool wrapper and the frontend `SessionPanel` affordance.

## Files touched

- `packages/@kalio/types/src/index.ts`
- `apps/kalio-api/src/database/schema.ts`
- `apps/kalio-api/src/modules/cli-agent/cli-agent.module.ts`
- `apps/kalio-api/src/modules/cli-agent/cli-agent-session.service.ts`
- `apps/kalio-api/src/modules/tool/tools/run-cli-agent.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/run-cli-agent.tool.spec.ts`
- `apps/kalio-api/src/modules/chat/sessions.service.ts`
- `apps/kalio-api/src/modules/chat/__tests__/sessions.service.spec.ts`
- `apps/kalio-web/src/features/sessions/SessionPanel.tsx`
- `apps/kalio-web/src/features/sessions/SessionPanel.test.tsx`

## Decisions

- Kept the first implementation local to `CLIAgentModule` instead of injecting `SessionsService` / `SessionManagerService` into the tool layer. This avoids reopening the ToolModule/ChatModule cycle problem.
- Used the existing session lineage fields (`parentSessionId`, `parentToolCallId`) and existing `session:created` event rather than inventing a new sidebar-specific integration path.
- Persisted the CLI output as a `tool_result` JSON payload inside the child session so opening the child session reuses the existing message history + tool bubble rendering path.

## Validation

- `cd apps/kalio-api && npx vitest run src/modules/tool/tools/run-cli-agent.tool.spec.ts`
- `cd apps/kalio-web && npx vitest run src/features/sessions/SessionPanel.test.tsx`
- `get_errors` on all touched backend/frontend files returned no errors.

## Open questions

- Live runtime state for CLI sessions still lives under the parent tool activity, not under the child session itself.
- Direct child guidance, stop, and reconnect replay are still unimplemented.
- Execution graph / canvas views still treat subagent child sessions as the richer first-class child path; CLI child-session visuals there remain follow-up work.

## Next steps

- Add a session-keyed runtime registry for CLI sessions so running/status/stop semantics belong to the child session instead of the parent tool bubble.
- Add direct message/continue support for an existing `cli-agent` session.
- Reuse the same lifecycle shape for subagents so both durable agent types converge on one session-first model.