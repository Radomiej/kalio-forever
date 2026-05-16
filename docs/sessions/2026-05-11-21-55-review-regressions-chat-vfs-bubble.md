# 2026-05-11 21:55 - Review regressions (chat gateway, VFS, tool bubble)

## What was done

- Triaged the pasted review against the current branch to separate stale comments from still-valid regressions.
- Fixed `ChatGateway` child-session authorization leakage by separating stream subscription from session ownership.
- Fixed `ChatGateway` disconnected-socket race so child-session emits cannot recreate a removed socket in internal subscription maps.
- Fixed `ChatInterface` so successful `run_subagent` results refresh the VFS file bar in `shared` mode even when `copiedFiles` is empty.
- Fixed `SessionVfsController.resolveServePath()` so fallback parsing strips query/hash fragments before decoding the VFS path.
- Hardened `ToolCallBubble` subagent payload parsing to reject malformed `copiedFiles` payloads instead of crashing.
- Switched `ToolCallBubble` child transcript fetches to `AbortController` so unmounted bubbles cancel the underlying request.

## Files touched

- `apps/kalio-api/src/modules/chat/chat.gateway.ts`
- `apps/kalio-api/src/modules/chat/__tests__/chat.gateway.spec.ts`
- `apps/kalio-api/src/modules/vfs/session-vfs.controller.ts`
- `apps/kalio-api/src/modules/vfs/session-vfs.controller.spec.ts`
- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.test.tsx`

## Decisions made

- `chat:stop` remains allowed for initiators of child sessions after streamed child events, but that access no longer implies permission for `tool:confirm`, `tool:cancel`, `raapp:approve`, or `raapp:cancel`.
- Child-session streaming now registers the initiator as a subscriber only, not an owner.
- The disconnected-socket fix was implemented with a client-presence guard in `subscribeSocketToSession()` plus full subscriber cleanup on disconnect, instead of broader lifecycle refactors.
- `run_subagent` VFS refresh was fixed at the FE predicate level because the behavioral distinction is whether the parent session VFS changed, not whether files were copied.
- Malformed `run_subagent` history payloads now fall back to generic JSON rendering instead of trying to coerce partial data into `SubagentToolResult`.

## Validation

- `apps/kalio-api`: `vitest run src/modules/chat/__tests__/chat.gateway.spec.ts` -> pass (13 tests)
- `apps/kalio-api`: `vitest run src/modules/vfs/session-vfs.controller.spec.ts` -> pass (23 tests)
- `apps/kalio-web`: `vitest run src/features/chat/ChatInterface.test.tsx` -> pass (42 tests)
- `apps/kalio-web`: `vitest run src/features/chat/ToolCallBubble.test.tsx` -> pass (18 tests)
- `apps/kalio-api`: `tsc --noEmit` -> pass
- `apps/kalio-web`: `tsc --noEmit` -> pass

## Open questions / deferred items

- Review notes about persona seeded-prompt heuristics are likely still valid but require a broader migration/versioning decision, not a local bug fix.
- Review notes about `sessions.parentSessionId` indexing and descendant-session query shape are likely valid performance follow-ups, but were deferred because the active ask was regression triage and correctness fixes.
- LLM/settings review comments around env provider switching, active credential clearing, runtime type guards, and shared provider URL/header logic were stale on this branch and were not changed in this slice.