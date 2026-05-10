# FE coverage lift

## What was done
- Added focused frontend tests for low-coverage services, hooks, utilities, and UI panels in `apps/kalio-web/src/`.
- Covered `apiClient`, `backendHealth`, `modelPrompts`, `settingsStore`, `tool.utils`, `raappRendererUtils`, `tileColors`, `useTileIcons`, `useContextUsage`, and several user-facing components/panels.
- Re-ran targeted Vitest batches during iteration, then validated frontend typecheck, build, and cleaned coverage runs.

## Files touched
- `apps/kalio-web/src/services/*.test.ts`
- `apps/kalio-web/src/features/chat/**/*.test.tsx`
- `apps/kalio-web/src/features/landing/*.test.tsx`
- `apps/kalio-web/src/features/raapp/*.test.ts`
- `apps/kalio-web/src/features/settings/*.test.tsx`
- `apps/kalio-web/src/features/tools/*.test.ts`
- `apps/kalio-web/src/features/vfs/*.test.tsx`

## Decisions made
- Focused on meaningful behavior coverage instead of shallow render-only assertions.
- Preferred smaller high-value modules/components over chasing large zero-coverage pages with brittle test setups.
- Used cleaned coverage runs (`rm -rf dist && pnpm test:cov`) because built output can cause Vitest to pick up compiled tests from `dist/`.

## Open questions
- Large zero-coverage pages remain in memory, observability, persona, mcp, workspace, and several settings surfaces.
- Repo-wide/frontend-wide lint still has pre-existing unrelated failures in production files, so only changed test files were linted cleanly here.

## Next steps
- Target one of the larger remaining feature areas (`MemoryPage`, `ObservabilityPage`, `PersonaPanel`, `MCPPanel`) if coverage needs to climb further.
- Consider excluding build output from Vitest discovery or ensuring tests always run from a cleaned frontend workspace.
