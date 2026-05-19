# Talk Graph Entry And Empty Session Shell

## What was done
- Added a dedicated `Conversation / Graph` switch to the left Talk sidebar so graph mode is visible before scanning the main panel header.
- Removed the disabled `Timeline` option from the Talk switch because it duplicated the chronological chat view and diluted the main graph affordance.
- Fixed the active-session empty graph state so switching to Graph on a fresh or idle session still shows the full graph shell instead of a bare placeholder.
- Added a Playwright regression spec for reaching graph mode from Talk without starting a conversation first.
- Manually verified the shared browser page with Playwright MCP and captured a screenshot showing the new sidebar graph entry.

## Files touched
- `apps/kalio-web/src/App.tsx`
- `apps/kalio-web/src/App.test.tsx`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphView.tsx`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphView.test.tsx`
- `apps/e2e/tests/regression-talk-graph-entry.spec.ts`

## Decisions
- Keep graph as a dual Talk view, not a separate workflow and not something users must start in.
- Do not ship Timeline right now; it is mostly a duplicate of the existing chat chronology and weakens graph discoverability.
- Treat the real UX bug as the combination of weak graph entry visibility and the missing graph shell for selected sessions with zero execution nodes.

## Validation
- `pnpm exec vitest run src/App.test.tsx --reporter=verbose` — passed
- `pnpm exec vitest run src/features/chat/graph/ExecutionGraphView.test.tsx --reporter=verbose` — passed
- `pnpm exec vitest run src/App.test.tsx src/features/chat/graph/ExecutionGraphView.test.tsx src/features/chat/graph/executionGraphModel.test.ts --reporter=verbose` — passed
- `pnpm exec tsc --noEmit` — passed
- `pnpm exec playwright test --project=chromium tests/regression-talk-graph-entry.spec.ts` with localhost env overrides — passed
- Manual Playwright MCP verification on the shared browser page — confirmed sidebar `Graph` button is visible and can be activated

## Notes
- The user's attached screenshot showed an older Talk layout without the new sidebar switch, which was consistent with a stale browser state rather than the current code.
- The updated shared-page screenshot now clearly shows `VIEW` with `Conversation` and `Graph` in the left sidebar, plus graph mode active in the main pane.