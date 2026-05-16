# App View State Hot Reload Fix

## What was done
- Fixed frontend view drift after hot reload/remount by persisting the current App view state in session storage.
- Added hydration on App startup/remount for the active top-level section and nested tabs.
- Covered the fix with focused Vitest component tests.

## Files touched
- `apps/kalio-web/src/App.tsx`
- `apps/kalio-web/src/App.test.tsx`

## Behavior change
- The app now remembers `activeSection`, `talkTab`, `toolsTab`, `mindTab`, and `selectedSkillId` under a session-scoped storage key.
- After a remount caused by hot reload, the UI restores the last open section/tab instead of falling back to the landing page.

## Validation
- Ran `pnpm vitest run src/App.test.tsx`
- Result: 2 tests passed

## Notes
- Used `sessionStorage` rather than `localStorage` so the remembered view is scoped to the current browser tab/session.
- Did not change chat/session Zustand persistence; this fix is limited to the UI shell state owned by `App.tsx`.

## Next steps
- If the live drift still reproduces, inspect whether any deeper child view keeps its own internal navigation state outside `App.tsx`.