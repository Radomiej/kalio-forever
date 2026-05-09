# Session Log — Subagent RAApp Render + Catalog Save

## What was done
- Fixed parent chat rendering so `run_subagent` can display RAApp generated inside child session:
  - `HistoryToolCallBubble` now fetches child session messages for sub-agent results.
  - It extracts the latest `tool_result` containing an RAApp payload and renders it inline.
  - Sub-agent result bubbles auto-expand by default so the widget is visible without extra clicks.
- Added regression test proving this path (`run_subagent` -> child `raapp_create` -> parent render).
- Implemented auto-save for `raapp_create` outputs into RA-App manager catalog:
  - Added `RAAppService.saveGeneratedApp()` that writes a generated ZIP in user catalog and loads it.
  - Updated `RaAppCreateTool` to persist every successful generated RAApp and return `storedAppId`.
- Added/updated tests for persistence behavior in `raapp_create` tool.

## Files touched
- `apps/kalio-web/src/features/chat/ToolCallBubble.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.test.tsx`
- `apps/kalio-api/src/modules/raapp/raapp.service.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-create.tools.spec.ts`

## Verification
- `pnpm --filter kalio-web test -- src/features/chat/ToolCallBubble.test.tsx` ✅
- `pnpm --filter kalio-api test -- src/modules/tool/tools/raapp-create.tools.spec.ts src/modules/tool/tools/raapp.tools.spec.ts` ✅
- `cd apps/kalio-api && node_modules\\.bin\\tsc.CMD --noEmit` ✅

## Notes
- Existing unrelated modified files remained untouched/reverted per workspace constraints.
- `raapp_create` now returns `storedAppId`, enabling follow-up references from manager/list flows.

## Follow-up (same day)
- Simplified sub-agent invocation contract for MVP:
  - `run_subagent` / `spawn_subagent` / `message_subagent` now use `inputPrompt` as primary prompt field.
  - `objective` is kept as backward-compatible alias.
  - `availableTools` request narrowing is no longer used for child runtime selection.
  - Child toolset is resolved from selected persona's `allowedTools`.
  - Added optional `attachments` paths; in isolated mode these are copied into child VFS under `attachments/` and the child prompt gets an attachment hint.
- HITL behavior adjusted:
  - Global confirmation timeout increased to 10 minutes.
  - For sub-agent turns, confirmation timeout is disabled (`timeoutMs: 0`) so user can switch to sub-session and confirm without auto-cancel.
- Added regression tests for all above behavior and verified green.
