# 2026-05-17 20:39 - reconnect pending chunk cleanup

## What was done

- Added a reconnect regression in `ChatInterface.test.tsx` that requires session-scoped pending chunk cleanup before history merge.
- Added a store regression in `sessionStore.spec.ts` that requires removing only the targeted session's pending chunk tracking.
- Introduced `clearPendingChunks()` in the Zustand session store.
- Hooked reconnect handling in `ChatInterface.tsx` to clear pending chunks for the active session before reloading message history.
- Ran a narrow TypeScript check for `apps/kalio-web` after the fix.

## Files touched

- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`
- `apps/kalio-web/src/store/sessionStore.ts`
- `apps/kalio-web/src/store/sessionStore.spec.ts`

## Decisions

- Chose explicit reconnect-time pending chunk cleanup instead of trying to teach `mergeFetchedMessages()` how to reconcile stale in-memory assistant partials against authoritative fetched history.
- Kept cleanup session-scoped so background or child-session streams are not discarded accidentally.

## Validation

- `pnpm exec vitest run src/features/chat/ChatInterface.test.tsx src/store/sessionStore.spec.ts --reporter=verbose` from `apps/kalio-web` — passed (`66` tests)
- `./node_modules/.bin/tsc.CMD --noEmit` from `apps/kalio-web` — passed (no output)

## Open questions

- If reconnect should eventually preserve unfinished assistant partials intentionally, that behavior needs a separate explicit policy rather than falling out of `mergePendingMessages()` implicitly.

## Next steps

- If more reconnect edge cases appear, add a higher-level regression that combines pending chunks with a fetched persisted assistant message for the same `messageId`.