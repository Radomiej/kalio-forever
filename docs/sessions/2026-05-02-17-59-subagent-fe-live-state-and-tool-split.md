# Subagent FE Live State And Tool Split

## What was done

- Finished the frontend per-session live-state migration so child/master chats keep isolated live messages, agent turns, tool activities, and context.
- Added explicit `spawn_subagent` and `message_subagent` tool aliases on top of the existing `run_subagent` contract for clearer semantics without breaking compatibility.
- Stabilized the main chat regression tests for the new session-aware store APIs and added a default history-fetch mock.
- Re-ran live browser verification for the exact scenario: parent -> child -> follow-up to same child -> direct user message inside the child chat.

## Files touched

- `apps/kalio-web/src/store/sessionStore.ts`
- `apps/kalio-web/src/store/sessionStore.spec.ts`
- `apps/kalio-web/src/store/sessionStore.test.ts`
- `apps/kalio-web/src/store/agentStore.ts`
- `apps/kalio-web/src/store/agentStore.spec.ts`
- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`
- `apps/kalio-api/src/modules/tool/tools/subagent.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/subagent.tool.spec.ts`
- `apps/kalio-api/src/modules/tool/tool.module.ts`
- `apps/kalio-api/src/modules/tool/tool-registry.service.ts`
- `apps/kalio-api/src/modules/tool/tool-registry.service.spec.ts`

## Key decisions

- Kept aggregate/global arrays in the frontend stores for canvas/global visibility, but made `ChatInterface` read and mutate the active session slice through per-session maps.
- Kept `run_subagent` as the compatibility boundary and implemented `spawn_subagent` / `message_subagent` as thin wrappers instead of duplicating runtime logic.
- Fixed the frontend type fallout at the root by switching `agentStore` from self-referential `useAgentStore.getState()` calls during initialization to Zustand's typed `get` callback.

## Validation

- `pnpm vitest run src/store/sessionStore.spec.ts src/store/agentStore.spec.ts src/features/chat/ChatInterface.test.tsx src/features/chat/CanvasPanel.test.tsx` in `apps/kalio-web`
- `pnpm vitest run src/modules/tool/tools/subagent.tool.spec.ts src/modules/tool/tool-registry.service.spec.ts` in `apps/kalio-api`
- `./node_modules/.bin/tsc.CMD --noEmit` in `apps/kalio-web`
- `./node_modules/.bin/tsc.CMD --noEmit` in `apps/kalio-api`
- Manual browser scenario at `http://localhost:5188`:
  - parent chat created one child session
  - parent reused the same `childSessionId` for the second delegated turn
  - canvas `Open` switched into the child chat and showed the child transcript as a normal conversation
  - direct user follow-up inside the child chat returned `USER-CHILD-OK`

## Findings

- The full manual scenario passed after the frontend per-session refactor.
- Standard browser clicks on the send button can still be intercepted by shell overlays in some layouts; keyboard submit worked reliably and matches the earlier known UI flake.
- `ChatInterface.test.tsx` is green now, but still emits React `act(...)` warnings from async component updates in the mocked environment. This is test-harness noise, not a failing behavior regression.

## Next steps

- If we want zero-warning frontend tests, add an async render helper around `ChatInterface` tests so post-mount effects settle inside `act`.
- If product copy/tool prompts should stop advertising the overloaded name, migrate orchestrator prompts/tool guidance toward `spawn_subagent` and `message_subagent` explicitly.