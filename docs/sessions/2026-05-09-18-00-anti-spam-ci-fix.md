# Anti-Spam CI Fix

## What was done

- Investigated CI-only failure in `tests/ac-13-anti-spam.spec.ts` where the first anti-spam case sometimes observed two user message bubbles or an enabled input after submit.
- Confirmed the E2E failure was caused by a frontend race, not by MockLLM behavior or stale test expectations.
- Added a focused regression test in `apps/kalio-web/src/features/chat/ChatInput.spec.tsx` that reproduces the gap between `onSend()` and the parent `disabled` prop catching up.
- Fixed `apps/kalio-web/src/features/chat/ChatInput.tsx` by adding a small local optimistic send lock so the textarea and send button disable immediately after submit and remain locked until the parent streaming cycle acknowledges and completes.
- Added a second unit test proving the lock releases normally after the parent transitions through `disabled=true` and back to `disabled=false`.
- Corrected `apps/e2e/tests/ac-13-anti-spam.spec.ts` so it counts only user bubbles (`data-role="user"`) instead of all `message-bubble` nodes, and uses unique per-run session titles to avoid retry collisions with stale sessions.

## Files touched

- `apps/kalio-web/src/features/chat/ChatInput.tsx`
- `apps/kalio-web/src/features/chat/ChatInput.spec.tsx`
- `apps/e2e/tests/ac-13-anti-spam.spec.ts`

## Root cause

- `ChatInterface` already guarded duplicate sends via store state, but `ChatInput` itself had no local latch.
- In the narrow window before the parent rerendered with `disabled=true`, CI could refill the textarea and click send again, producing a second user message.
- The race was easier to hit in GitHub Actions than locally because the Playwright sequence landed inside that render gap.
- The failing Playwright assertion also overcounted by querying every `message-bubble`, which includes both user and assistant bubbles in the current UI.

## Validation

- `pnpm exec vitest run src/features/chat/ChatInput.spec.tsx -t "locks immediately after send so a second prompt cannot slip in before parent disables"`
- `pnpm exec vitest run src/features/chat/ChatInput.spec.tsx`
- `pnpm --filter @kalio/e2e exec playwright test tests/ac-13-anti-spam.spec.ts --project=chromium --repeat-each=8`
- `pnpm --filter @kalio/e2e exec playwright test tests/ac-01-streaming.spec.ts tests/ac-13-anti-spam.spec.ts --project=chromium`
- Final anti-spam stress result: `16 passed`, `0 failed`.

## Notes

- This fix is intentionally local to `ChatInput`; it does not change backend behavior or session/message semantics.
- The existing `ChatInterface` synchronous `isStreaming` guard remains in place as a second line of defense.