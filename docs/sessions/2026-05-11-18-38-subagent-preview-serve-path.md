# Subagent preview default + serve-path fallback

## What was done
- Added a backend regression for `SessionVfsController.servePath()` when Nest leaves the wildcard `path` param empty on live `serve-path/*path` requests.
- Added frontend regressions for `run_subagent` history bubbles so copied file paths and verbose child output stay collapsed by default while the child preview stays visible.
- Fixed `servePath()` to recover the file path from `request.originalUrl` when the wildcard binding is missing.
- Reworked `SubagentResultBlock` to render the child RA-App preview first and gate verbose child output plus copied file paths behind a dedicated details toggle.

## Files touched
- `apps/kalio-api/src/modules/vfs/session-vfs.controller.ts`
- `apps/kalio-api/src/modules/vfs/session-vfs.controller.spec.ts`
- `apps/kalio-web/src/features/chat/ToolCallBubble.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.spec.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.test.tsx`

## Decisions
- Kept the path-based VFS preview route because it is still the right contract for relative asset resolution; fixed the route binding gap instead of falling back to `serve?path=` in the frontend.
- Kept the `run_subagent` history chip expanded so the preview is immediately visible, but moved verbose child output behind a separate toggle inside the subagent block.

## Validation
- `cd apps/kalio-api; pnpm vitest run src/modules/vfs/session-vfs.controller.spec.ts`
- `cd apps/kalio-web; pnpm vitest run src/features/chat/ToolCallBubble.spec.tsx src/features/chat/ToolCallBubble.test.tsx`
- Live request: `GET /api/sessions/sub-b78a7cd6-e670-4332-8261-41e100f20d07/vfs/serve-path/bloom-brief/design-brief.html` -> `200 text/html; charset=utf-8`
- `cd apps/kalio-web; pnpm exec tsc --noEmit`
- `cd apps/kalio-api; pnpm exec tsc --noEmit` still fails on pre-existing `LLMService` contract errors in `llm.controller.ts` and `llm.service.spec.ts`

## Open questions
- The backend app still has unrelated type errors around missing `LLMService.getActiveModels` and `LLMService.updateActiveModel`; those were not touched here.