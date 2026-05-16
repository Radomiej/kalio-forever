# Chat Ordering And Canvas Preview Fix

## What was done

- Fixed the main chat timeline so agent turns are no longer interleaved with user prompts by plain array index.
- Added `promptMessageId` anchoring to frontend `AgentTurn` state and history reconstruction so a later agent reply stays attached to the user prompt that actually started that turn.
- Replaced the inline index-zip render logic in `ChatInterface` with a timeline builder that inserts each agent turn after its anchored user message.
- Fixed canvas sub-agent preview ordering so preview cards render oldest-to-newest by session recency instead of insertion order.
- Hardened the preview excerpt so the visible sub-agent chat lines are sorted chronologically before selecting the last two entries.
- Added focused frontend regressions for both the misanchored chat-turn case and the reversed canvas preview ordering.

## Files touched

- `apps/kalio-web/src/store/sessionStore.helpers.ts`
- `apps/kalio-web/src/store/sessionStore.ts`
- `apps/kalio-web/src/features/chat/chatUtils.ts`
- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/CanvasPanel.tsx`
- `apps/kalio-web/src/features/chat/chatUtils.spec.ts`
- `apps/kalio-web/src/features/chat/CanvasPanel.test.tsx`

## Decisions

- Did not add a backend/database linked-list style message chain. The ordering bug was in frontend turn reconstruction and render anchoring, not in persisted session history ordering.
- Kept the fix local to frontend `AgentTurn` metadata by storing the user prompt anchor as `promptMessageId`.
- Sorted canvas sub-agent cards by `session.updatedAt` ascending so the newest card appears at the bottom of the right panel.

## Validation

- `pnpm --filter kalio-web exec vitest run src/features/chat/chatUtils.spec.ts src/features/chat/CanvasPanel.test.tsx`
- Result: 27 tests passed.
- VS Code diagnostics on touched frontend files: no errors.
- `cd apps/kalio-web; node_modules\.bin\tsc.CMD --noEmit`
- Result: passed with no errors.

## Open questions

- None for this slice. If chat timeline rendering grows more complex, consider keeping the anchoring logic centralized in `chatUtils.ts` instead of reintroducing local render ordering heuristics.