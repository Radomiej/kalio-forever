# 2026-05-16-16-39 - stale confirmation e2e seed path

## What was done

Added a deterministic backend test-support path for replayed HITL confirmations on the isolated E2E stack.

Implemented:
- `POST /api/test-support/tool-confirmations/seed-replay` to seed minimal chat history plus a pending confirmation for a target session when `NODE_ENV=test`.
- `POST /api/test-support/tool-confirmations/drop` to remove a seeded pending confirmation without emitting a live invalidation, so Playwright can reproduce a stale confirm click deterministically.
- `ToolDispatchService.seedPendingConfirmation()` and `dropPendingConfirmation()` as the minimal runtime hooks behind that test-support surface.
- AC-02 Playwright regression for replayed stale confirmation cleanup on the dedicated `3316/5288` mock-backed lane.
- Frontend fix in `ChatInterface` so `tool:confirmation_invalidated` can recover the original `toolCallId` from locally cached pending confirmation state when the backend emits `reason: 'not_found'` without `toolCallId`.

## Validation

- Focused Playwright: `apps/e2e/tests/ac-02-hitl-confirmation.spec.ts` - pass
- Narrow TypeScript checks:
  - `apps/kalio-api` `tsc --noEmit` - pass
  - `apps/kalio-web` `tsc --noEmit` - pass

## Files touched

- `apps/e2e/tests/ac-02-hitl-confirmation.spec.ts`
- `apps/kalio-api/src/modules/chat/tool-dispatch.service.ts`
- `apps/kalio-api/src/modules/chat/chat-test-support.service.ts`
- `apps/kalio-api/src/modules/chat/chat-test-support.controller.ts`
- `apps/kalio-api/src/modules/chat/chat.module.ts`
- `apps/kalio-web/src/features/chat/ChatInterface.tsx`

## Decisions

- Kept the seed API test-only by returning `404` outside `NODE_ENV=test` instead of exposing new production-facing contracts.
- Seeded the minimum visible replay fixture: one user message, one assistant tool-call message, and one pending confirmation.
- Fixed stale invalidation locally in the frontend store instead of widening the socket contract again; the browser already has the original request cached at click time.

## Open follow-up

- The new seed API is generic enough to target child sessions too, but the current Playwright regression covers replay inside the active session. Parent-view child replay coverage can now be added on top of the same seed/drop endpoints without more backend plumbing.