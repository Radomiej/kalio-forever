# Graph View Empty State And Browser Polish

## What was done
- Polished the Talk view switch so `Conversation / Graph / Timeline` is visibly grouped and labeled as `Talk view`.
- Reworked `ExecutionGraphView` so it is useful even when no active session is selected.
- Added a graph empty-state overview with:
  - session quick-picks
  - live agent summary
  - running tools summary
  - recent sessions list
- Added live counters and live chips for active agents and running tools in the graph header.
- Validated the result in the shared localhost browser page.

## Files touched
- `apps/kalio-web/src/App.tsx`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphView.tsx`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphView.test.tsx`

## Decisions
- Kept the graph empty-state inside the graph canvas surface instead of redirecting users back to Conversation mode.
- Exposed duplicate session-entry buttons with distinct accessible labels (`graph overview` vs `recent session`) to avoid ambiguous screen-reader output and unstable tests.
- Used the existing frontend store state for live agent/tool summaries rather than introducing new backend data sources.

## Validation
- `pnpm exec vitest run src/features/chat/graph/ExecutionGraphView.test.tsx --reporter=verbose` — passed
- `pnpm exec vitest run src/App.test.tsx src/features/chat/graph/executionGraphModel.test.ts src/features/chat/graph/ExecutionGraphView.test.tsx --reporter=verbose` — passed
- `pnpm exec tsc --noEmit` — passed
- Browser verification on `http://localhost:5188/` — confirmed the Talk view switch is visible and the Graph view now shows overview content instead of a dead-end placeholder.

## Notes from browser verification
- The shared page currently had no active agent runs, so the new `Live agents` and `Running tools` sections correctly rendered empty-state text.
- The conversations list loaded with hundreds of sessions (`309 chats`), confirming the graph empty-state now has enough surrounding context to guide the user into a real session.