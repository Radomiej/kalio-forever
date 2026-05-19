# Tool Intent Fallback Live + Mock

## What was done

- Wired `ChatInterface` to consume `tool:arg_progress` and synthesize zero-char `Preparing <tool>` state on early tool intent when no real arg chunks have been seen yet.
- Added deterministic mock-provider trigger `[[mock:tool:raapp_create:no-arg-progress]]` that returns a `raapp_create` tool call without streamed arg-progress chunks.
- Fixed the render gap for the fallback path by showing `Preparing/Writing <tool>` inside `ConfirmationInlineBubble`, not only in the empty-turn loading indicator.
- Updated the live Playwright probe to watch both `turn-loading-indicator` and `tool-arg-progress-indicator`.
- Added a deterministic Playwright spec for the mock fallback path.

## Files touched

- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.spec.tsx`
- `apps/kalio-api/src/modules/llm/providers/mock.provider.ts`
- `apps/kalio-api/src/modules/llm/providers/mock.provider.spec.ts`
- `apps/e2e/tests/live-tool-arg-progress.spec.ts`
- `apps/e2e/tests/mock-tool-intent-fallback.spec.ts`

## Decisions

- Kept the synthetic fallback keyed off `tool:confirmation_required` only when no real arg-progress has already been observed for that session/tool.
- Rendered fallback progress in the confirmation bubble because `turn.items.length > 0` suppresses the top-level loading indicator as soon as the tool activity is added.
- Left the real-key Playwright coverage env-gated and added a deterministic mock spec for CI-stable coverage.

## Validation

- `pnpm --filter kalio-web exec vitest run src/features/chat/ChatInterface.test.tsx -t "tool:arg_progress updates toolArgProgress|synthesizes Preparing fallback"`
- `pnpm --filter kalio-web exec vitest run src/features/chat/ToolCallBubble.spec.tsx -t "awaiting confirmation keeps showing synthetic Preparing progress"`
- `pnpm --filter kalio-api exec vitest run src/modules/llm/providers/mock.provider.spec.ts`
- Real-key Playwright passed:
  `pnpm --filter @kalio/e2e exec playwright test tests/live-tool-arg-progress.spec.ts --project=chromium --reporter=list -g "web chat renders tool intent or progress text before tool:start with the live provider"`
- Deterministic mock Playwright passed:
  `pnpm --filter @kalio/e2e exec playwright test tests/mock-tool-intent-fallback.spec.ts --project=chromium --reporter=list`

## Open questions

- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx` still has an unrelated pre-existing failure around history hydration (`calls setAgentTurns from history when no active agent loop exists for the session`).

## Next steps

- If desired, add a second mock-provider marker for deterministic positive arg-progress streaming so UI text can be covered without the live-provider lane.