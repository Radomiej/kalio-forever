# 2026-05-17 19:01 - history merge dedup and reconnect scope

## What was done

- Added failing regressions for optimistic history deduplication in `chatUtils.spec.ts`.
- Added a failing reconnect regression in `ChatInterface.test.tsx` to prove reconnect cleanup must stay scoped to the active session.
- Changed `mergeFetchedMessages()` to pair optimistic and fetched messages by semantic keys when IDs differ.
- Scoped reconnect-time `clearToolActivities()` to the active session instead of wiping all session activity state.

## Files touched

- `apps/kalio-web/src/features/chat/chatUtils.ts`
- `apps/kalio-web/src/features/chat/chatUtils.spec.ts`
- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`

## Decisions

- Kept the dedup fix frontend-only because the shared `chat:send` contract still does not carry a client message ID and `packages/@kalio/types/**` was out of scope.
- Preserved the local optimistic message identity during merge so active prompt anchoring in the current page session does not churn while the server catches up.
- Limited reconnect cleanup to the active session because graph/canvas views can simultaneously surface child-session tool activity.

## Validation

- `pnpm --filter kalio-web exec vitest run src/features/chat/chatUtils.spec.ts src/features/chat/ChatInterface.test.tsx --reporter=verbose`
- Result: all `72` targeted tests passed.

## Open questions

- If future work adds a client-generated message correlation ID to the wire contract, `mergeFetchedMessages()` can simplify and drop the semantic fallback pairing for optimistic user messages.

## Next steps

- Consider a narrow follow-up regression around reconnect plus pending chunk state if history reloads ever race with unfinished assistant chunks.