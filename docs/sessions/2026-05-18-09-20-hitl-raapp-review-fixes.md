# HITL / RA-App review fixes

## What was done

- Added fail-first regression coverage for the review findings around auto-HITL abort propagation, RA-App native output handling, and HITL settings save behavior.
- Propagated the turn `abortSignal` through `ToolDispatchService`, `HitlDecisionService`, and RA-App native approval auto-resolution.
- Extended RA-App approval resolution to return `outputPatches`, then applied those patches back into GUI `data.output` in both stored-app and draft execution flows.
- Extended the shared RA-App block/result contract with `nativeResults` so the frontend parser and renderer can surface server-side native execution results.
- Changed HITL config saving so backend persona validation only runs for `auto` mode and frontend manual/bypass saves omit stale `autoPersonaId`.
- Updated architecture docs to describe the real abort and RA-App approval flow.

## Files touched

- `packages/@kalio/types/src/index.ts`
- `apps/kalio-api/src/modules/chat/tool-dispatch.service.ts`
- `apps/kalio-api/src/modules/hitl/hitl.types.ts`
- `apps/kalio-api/src/modules/hitl/hitl-decision.service.ts`
- `apps/kalio-api/src/modules/hitl/hitl-config.service.ts`
- `apps/kalio-api/src/modules/raapp/raapp-hitl.service.ts`
- `apps/kalio-api/src/modules/raapp/raapp-output-patches.util.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-draft.tools.ts`
- `apps/kalio-web/src/features/settings/HITLSettingsPanel.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.parsers.ts`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphPreview.tsx`
- `apps/kalio-web/src/features/raapp/RAAppRenderer.tsx`
- corresponding backend/frontend regression specs
- `docs/chat-streaming-tools-architecture.md`
- `docs/raapp-design-current.md`

## Decisions

- Kept `abortSignal` as an optional backend-only field on `ToolCallRequest` so existing tool callers do not need invasive changes.
- Represented auto-approved native side effects as two parallel outputs: `nativeResults` for UI visibility and `outputPatches` for deterministic GUI binding updates.
- Made the patch application utility tolerant of missing `outputPatches` so older mocks and partial callers do not crash tool execution.

## Validation

- `cd apps/kalio-api && pnpm exec vitest run src/modules/hitl/hitl-decision.service.spec.ts src/modules/chat/__tests__/tool-dispatch.service.spec.ts src/modules/raapp/raapp-hitl.service.spec.ts src/modules/tool/tools/raapp.tools.spec.ts src/modules/tool/tools/raapp-draft.tools.spec.ts src/modules/hitl/hitl-config.service.spec.ts`
- `cd apps/kalio-web && pnpm exec vitest run src/features/settings/HITLSettingsPanel.test.tsx src/features/chat/ToolCallBubble.test.tsx src/features/raapp/RAAppRenderer.test.tsx`
- `pnpm turbo run typecheck --filter=./packages/@kalio/types --filter=./apps/kalio-api --filter=./apps/kalio-web`

## Open questions

- `nativeResults` are now rendered inline, but there is still no richer UX for browsing large structured native payloads.
- Auto-approved native approval rows are still persisted before immediate execution; if cleanup semantics change later, audit and replay expectations will need a separate review.