# VFS Preview CORS Fix

## What was done

- Added a frontend regression test proving `VfsHtmlRenderer` preflight must stay credential-free for the cross-origin `serve-path` preview URL.
- Removed `credentials: 'include'` from the preflight `fetch()` in `VfsHtmlRenderer`.
- Updated repo memory because the prior note incorrectly claimed preview preflight should include credentials.

## Files touched

- `apps/kalio-web/src/features/raapp/VfsHtmlRenderer.tsx`
- `apps/kalio-web/src/features/raapp/VfsHtmlRenderer.test.tsx`
- `/memories/repo/raapp-vfs-preview-session-scope.md`

## Decisions

- Treated this as a frontend contract bug, not a VFS write bug: `design_preview` already verifies the HTML file exists before returning a ready block.
- Kept the preflight itself, because it still provides a friendly unavailable state for missing/expired previews.
- Fixed the CORS mismatch at the caller instead of broadening backend credential policy.

## Validation

- `pnpm vitest run src/features/raapp/VfsHtmlRenderer.test.tsx`
  - failed before the implementation change on the new regression
  - passed after the implementation change
- `pnpm exec tsc --noEmit` in `apps/kalio-web`
  - completed without output

## Open questions

- The earlier user report about live `vfs_write` visibility was not reproduced in this slice. Current chat wiring still adds live tool activities and tool turn items on `tool:start`.
- If preview errors persist in the browser after this fix, the next check should be a real runtime request against `/api/sessions/:id/vfs/serve-path/...` to confirm whether any backend 500 remains once the CORS block is gone.