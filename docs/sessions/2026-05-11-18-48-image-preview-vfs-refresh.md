# Image preview + VFS refresh invalidation

## What was done
- Investigated why `image_generate` results were not visible in the brief or in the VFS files bar.
- Confirmed the backend VFS list already recursively scans the full session tree via `VFSService.listFiles()` + `walkDir()`, so the frontend did not need manual folder rescans.
- Added frontend regressions proving the Files bar must refresh after successful `image_generate` and `image_edit` results.
- Added a regression proving `run_subagent` bubbles must surface child image previews from the child transcript, not only child RA-App previews.
- Updated `ChatInterface` to refresh the VFS files bar via event-driven invalidation for file-producing tool results (`vfs_write`, `image_generate`, `image_edit`, and `run_subagent` with copied outputs).
- Updated `ToolCallBubble` so `SubagentResultBlock` fetches both the latest child RA-App preview and child image results, rendering generated images inline in the parent bubble.

## Files touched
- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.tsx`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.test.tsx`

## Decisions
- Kept the backend as the source of truth for the full recursive VFS listing instead of introducing frontend-side folder scanning.
- Used invalidation/refetch after successful tool mutations rather than polling.
- Kept the implementation simple: explicit file-producing tool detection plus `run_subagent` copied-output detection, without introducing a broader cache library.

## External confirmation
- React docs: avoid extra synchronization logic when a simpler event-driven update is enough.
- TanStack Query docs: prefer manual invalidation/refetch over ad-hoc polling when data changes after mutations.
- Perplexity summary aligned with the same approach: backend authoritative tree + event-driven invalidation, with optional optimistic inserts later if needed.

## Validation
- `cd apps/kalio-web; pnpm vitest run src/features/chat/ChatInterface.test.tsx src/features/chat/ToolCallBubble.test.tsx`
- `cd apps/kalio-web; pnpm exec tsc --noEmit`

## Open follow-up
- `ConversationFilesBar` still previews selected files as text via `/vfs/read`; if we want first-class image preview inside the Files modal itself, that should be a separate tested change.