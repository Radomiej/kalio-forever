# 2026-05-16-15-56 — Stale confirmation invalidation + raapp_create allowlist

## What was done

Implemented the stale-confirmation cleanup path as a runtime contract instead of another frontend-only workaround.

### Backend/runtime
- Added `tool:confirmation_invalidated` to shared socket contracts.
- `ToolDispatchService` now emits invalidation when a confirmation request is resolved, cancelled, or times out.
- `ChatGateway` now emits targeted invalidation with reason `not_found` when the client clicks confirm/cancel for a request that no longer exists.
- Removed `raapp_create` from the child `autoApproveTools` safelist. The remaining built-in opt-in safelist entry is `image_generate`.

### Frontend
- `ChatInterface` now listens for `tool:confirmation_invalidated`, removes the pending confirmation cache entry, and marks the associated tool activity as `expired` or `cancelled`.
- `ToolCallBubble` no longer clears pending confirmation state optimistically on local confirm/cancel clicks; it waits for the backend invalidation path.
- `ToolActivityRow` now renders the new `expired` status.

### Tests and docs
- Added backend regressions for timeout invalidation, missing-request invalidation, and `raapp_create` still requiring HITL in child runs.
- Updated frontend regressions so confirm/cancel waits for backend invalidation and so invalidation marks tool activity as expired.
- Updated architecture docs to describe the new invalidation contract and the current `raapp_create` persistence lane.

## Validation

- Backend focused Vitest: pass
  - `tool-dispatch.service.spec.ts`
  - `chat.gateway.spec.ts`
- Frontend focused Vitest: pass
  - `ToolCallBubble.spec.tsx`
  - `ChatInterface.test.tsx`
- API typecheck: pass
- Web typecheck: initially failed due missing `expired` mappings in `ToolActivityRow.tsx`; fixed and rerun green

## Files touched

- `packages/@kalio/types/src/index.ts`
- `packages/@kalio/sdk/src/index.ts`
- `apps/kalio-api/src/modules/chat/tool-dispatch.service.ts`
- `apps/kalio-api/src/modules/chat/chat.gateway.ts`
- `apps/kalio-api/src/modules/chat/__tests__/tool-dispatch.service.spec.ts`
- `apps/kalio-api/src/modules/chat/__tests__/chat.gateway.spec.ts`
- `apps/kalio-web/src/store/agentStore.ts`
- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.spec.tsx`
- `apps/kalio-web/src/features/chat/ToolActivityRow.tsx`
- `docs/tool-architecture.md`
- `docs/raapp-design-current.md`
- `docs/raapp-v2-architecture-current.md`
- `docs/sessions/2026-05-12-00-45-review-batch-child-reconnect-contracts.md`

## Decisions

- Stale confirmation is a protocol/state-sync problem, not a reconnect ownership problem.
- Backend invalidation is now the authoritative cleanup signal for pending confirmation UI.
- `raapp_create` stays confirmation-required for child runs because it creates durable catalog state.

## Open questions / next steps

1. Deterministic E2E coverage still needs a dedicated test-support seed path for pending confirmations. The current repo does not already expose one.
2. `replay_stale` exists in the invalidation reason union but is not emitted yet. If reconnect replay needs its own explicit cleanup reason later, that should be added in a separate focused slice.
3. If product wants delegated RA-App creation without HITL, that needs a written policy decision first, not another ad hoc allowlist exception.
