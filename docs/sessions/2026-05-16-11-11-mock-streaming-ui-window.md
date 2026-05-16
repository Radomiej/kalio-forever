# Mock Streaming UI Window

## What was done

- Moved chat streaming reset off `useChatSessionActivation` and into `sessionStore.setActiveSession` so session activation effects no longer clobber freshly started turns.
- Kept the chat composer in streaming mode across the pre-first-chunk gap by adding `awaitingFirstChunk` handling in `ChatInterface` and deriving composer state from `isStreaming || awaitingFirstChunk || hasPendingChunksForSession(activeSessionId)`.
- Hardened `ChatInput` so stop mode can render while the local send lock is active.
- Added E2E helpers to activate the intended session via DOM click and verify the `sessionStorage` active-session key before sending.
- Made focused E2E cleanup best-effort and removed the invalid forced fill against a disabled anti-spam input.

## Files touched

- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/ChatInput.tsx`
- `apps/kalio-web/src/features/chat/ChatInput.spec.tsx`
- `apps/kalio-web/src/features/chat/hooks/useChatSessionActivation.ts`
- `apps/kalio-web/src/store/sessionStore.ts`
- `apps/kalio-web/src/store/sessionStore.test.ts`
- `apps/e2e/tests/helpers/test-config.ts`
- `apps/e2e/tests/ac-01-streaming.spec.ts`
- `apps/e2e/tests/ac-13-anti-spam.spec.ts`

## Decisions

- The mock provider was not the root cause; it already streamed chunk-by-chunk. The missing UI window came from frontend state collapsing too early.
- `setActiveSession` is the correct place for real session-switch resets. Late activation effects should not mutate streaming state.
- For Playwright session activation in the sidebar, waiting for visibility alone was insufficient. The reliable signal is the `kalio:last-active-session-id` sessionStorage key.
- `CI=true` Chromium remains the trustworthy PR gate. A warm local rerun without CI still showed retry-only flake in `ac-01`, even though CI-mode and the full CI-parity Chromium suite passed.

## Validation

- `pnpm exec vitest run src/store/sessionStore.test.ts src/features/chat/ChatInput.spec.tsx src/features/chat/ChatInterface.test.tsx`
  - 66 passed
- `CI=true pnpm exec playwright test --project=chromium tests/ac-01-streaming.spec.ts tests/ac-13-anti-spam.spec.ts`
  - 5 passed
- `CI=true pnpm exec playwright test --project=chromium`
  - 144 passed, 14 skipped, 0 failed

## Open questions

- A non-CI focused local rerun still produced retry-only flake in `ac-01-streaming.spec.ts`. CI-parity validation is green, but if local warm-stack determinism becomes important, the remaining retry behavior is the next place to inspect.