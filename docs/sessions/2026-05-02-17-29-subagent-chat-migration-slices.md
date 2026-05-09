# Subagent Chat Migration Slices

## What was done

- Added TDD coverage for the first migration slices that move sub-agents closer to ordinary chat sessions.
- Implemented backend reuse of an existing child sub-agent session via `run_subagent(childSessionId=...)`.
- Implemented gateway fan-out of session-scoped chat events to other sockets that identified a given session.
- Implemented CanvasPanel live child transcript rendering from normal session streaming buffers and child-session subscription via the normal event bus.

## Files touched

- `apps/kalio-api/src/modules/chat/__tests__/subagent-runtime.service.spec.ts`
- `apps/kalio-api/src/modules/chat/__tests__/chat.gateway.spec.ts`
- `apps/kalio-api/src/modules/chat/chat.gateway.ts`
- `apps/kalio-api/src/modules/chat/subagent-runtime.service.ts`
- `apps/kalio-api/src/modules/chat/sessions.service.ts`
- `apps/kalio-api/src/modules/tool/subagent-runtime.port.ts`
- `apps/kalio-api/src/modules/tool/tools/subagent.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/subagent.tool.spec.ts`
- `apps/kalio-web/src/features/chat/CanvasPanel.tsx`
- `apps/kalio-web/src/features/chat/CanvasPanel.test.tsx`

## Key decisions

- No DB migration was needed for this slice because `sessions.parentSessionId` and related metadata already exist in the schema.
- `run_subagent` remains the integration boundary for the master, but it can now continue an existing child chat instead of always spawning a fresh session.
- Gateway delivery stays backward-compatible for the initiating socket while also broadcasting by `sessionId` to other subscribed sockets.
- Canvas now prefers normal session live buffers for child transcript freshness instead of waiting for persisted REST history to catch up.

## Tests added

- `SubagentRuntimeService`: reuses an existing child session so the parent can send another message into the same sub-agent chat.
- `ChatGateway`: broadcasts child-session stream events to sockets that identified that child session.
- `SubagentTool`: forwards `childSessionId` to the runtime so the master can continue an existing sub-agent chat.
- `CanvasPanel`: subscribes to child sessions and shows live streamed child responses before REST history catches up.

## Validation run

- `pnpm vitest run src/modules/chat/__tests__/subagent-runtime.service.spec.ts`
- `pnpm vitest run src/modules/chat/__tests__/chat.gateway.spec.ts`
- `pnpm vitest run src/modules/tool/tools/subagent.tool.spec.ts`
- `pnpm vitest run src/features/chat/CanvasPanel.test.tsx`
- `./node_modules/.bin/tsc.CMD --noEmit` in `apps/kalio-api`
- `./node_modules/.bin/tsc.CMD --noEmit` in `apps/kalio-web`

## Remaining follow-up

- `ChatInterface` still reconstructs full turn rendering only for the active session; if we want truly equal live UX between master and child chats everywhere, the next step is per-session live turn state.
- The current gateway fan-out was applied to turn-stream events emitted through `handleChatSend`; if other session-scoped side channels should also broadcast to observers, they need the same routing treatment.
- The sub-agent follow-up contract currently reuses `run_subagent` with `childSessionId`; a later cleanup may split this into explicit `spawn_subagent` and `message_subagent` tools if clearer semantics are needed.