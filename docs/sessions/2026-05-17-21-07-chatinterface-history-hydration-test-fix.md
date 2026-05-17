# ChatInterface History Hydration Test Fix

## What was done

- Investigated the remaining failing `ChatInterface.test.tsx` regression: `calls setAgentTurns from history when no active agent loop exists for the session`.
- Confirmed the production history hydration path in `useChatSessionActivation.ts` depends on `useSessionStore.getState().getSessionMessages(activeSessionId)`.
- Fixed the `ChatInterface.test.tsx` session-store mock to expose `getSessionMessages`, so the test exercises the real merge/history path instead of throwing and falling into the hook's error handler.

## Files touched

- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`

## Validation

- `pnpm --filter kalio-web exec vitest run src/features/chat/ChatInterface.test.tsx -t "calls setAgentTurns from history when no active agent loop exists for the session"`
- `pnpm --filter kalio-web exec vitest run src/features/chat/ChatInterface.test.tsx`

## Outcome

- The previously failing regression now passes.
- The full `ChatInterface.test.tsx` file is green: 48 tests passed.