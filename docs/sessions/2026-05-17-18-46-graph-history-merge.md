# 2026-05-17 18:46 — graph history merge

## What was done

- Reproduced the graph double-entry issue as a history hydration bug rather than a graph layout bug.
- Added `ChatInterface` regressions that proved stale history loads could erase an optimistic user prompt before `agent:start`, leaving `promptMessageId` undefined.
- Fixed session activation and reconnect history reloads to merge fetched messages with current local session messages before calling `setMessages()` and before rebuilding history turns.
- Moved the fetched-history merge helper into `chatUtils.ts` and reused it from `CanvasPanel` so historical transcript hydration follows one rule.
- Added edge-case coverage for `mergeFetchedMessages()` and `executionGraphModel` so anchored turns and genuine orphan fallbacks are both exercised outside the `ChatInterface` surface.
- Fixed `ToolCallBubble` inline confirmation actions to clear pending confirmations immediately after Confirm/Cancel, matching `ExecutionGraphView` and restoring the full frontend test suite.

## Files touched

- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/hooks/useChatSessionActivation.ts`
- `apps/kalio-web/src/features/chat/chatUtils.ts`
- `apps/kalio-web/src/features/chat/CanvasPanel.tsx`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`
- `apps/kalio-web/src/features/chat/chatUtils.spec.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.test.ts`
- `apps/kalio-web/src/features/chat/ToolCallBubble.tsx`

## Decisions

- Kept the synthetic graph fallback for genuinely orphaned turns; the fix targets history hydration, not graph presentation.
- Chose merge-overwrite semantics for fetched history so reloads preserve optimistic prompts, streaming metadata, and local tool-result details until the server catches up.
- Validated the fix through `ChatInterface.test.tsx` because that control path covers both session activation and socket reconnect, which are the two known ways the bug appeared.
- Treated the `ToolCallBubble.spec.tsx` failures as a real frontend inconsistency, not a flaky suite issue, because `ExecutionGraphView` already used optimistic `setPendingConfirmation(sessionId, null)` clearing for the same user action.

## Validation

- `pnpm --filter kalio-web exec vitest run src/features/chat/ChatInterface.test.tsx --reporter=verbose` ✅
- `pnpm --filter kalio-web exec vitest run src/features/chat/chatUtils.spec.ts src/features/chat/graph/executionGraphModel.test.ts --reporter=verbose` ✅
- `pnpm --filter kalio-web exec vitest run src/features/chat/ToolCallBubble.spec.tsx --reporter=verbose` ✅
- `pnpm --filter kalio-web exec vitest run --reporter=verbose` ✅ full frontend suite green
- `pnpm turbo run test` ❌ repo still fails in backend (`kalio-api`) outside the touched frontend flow:
	- `src/modules/raapp/raapp-versioning.service.spec.ts` — `RAAppVersioningService > approveDraft > accumulates history entries across successive approvals`
	- environmental/runtime failures also reported around `image-edit.tool.spec.ts`, `image-generate.tool.spec.ts`, and `zip-archive.util.spec.ts`

## Open questions

- If the backend can ever return a partially ordered history snapshot across persistence boundaries, we may still want a dedicated model-level regression in `executionGraphModel.test.ts` to guard the synthetic fallback path directly.

## Next steps

- If the graph still shows a duplicate entry after a full frontend reload, inspect whether any other message loaders outside `ChatInterface` and `useChatSessionActivation` still overwrite local session messages without merging.