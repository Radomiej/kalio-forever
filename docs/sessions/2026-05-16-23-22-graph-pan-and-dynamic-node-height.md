# Graph Pan And Dynamic Node Height

## What was done
- Replaced scroll-bound graph dragging with stage translation so pan is no longer capped by the viewport scroll boundary.
- Added a desktop mouse fallback next to pointer drag handling so the drag behavior is stable in both the browser and the test environment.
- Introduced variable node-height estimation for richer graph nodes, especially turn and subagent cards with longer content or more metadata.
- Changed graph row layout to use the tallest node in each row so tool nodes below a larger card are pushed down instead of overlapping visually.
- Reworked node card presentation so headline, eyebrow, and metadata are visually separated instead of blending into one text block.
- Rendered labeled metadata chips for turn/subagent/tool/artifact/final nodes so actor/model/args stand out clearly.

## Files touched
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphBoard.tsx`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphBoard.test.tsx`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.test.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.helpers.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphNodePresentation.ts`

## Decisions
- Kept layout estimation in a separate helper file so the already oversized `executionGraphModel.ts` did not absorb more presentation logic.
- Used row-height aggregation instead of DOM measurement, which keeps the graph projection deterministic and testable.
- Preserved the existing graph semantics and edge routing; the change only affects drag behavior, node sizing, and card readability.
- Left existing `act(...)` warnings in `ExecutionGraphView.test.tsx` untouched because they predate this slice and do not fail the tests.

## Validation
- `pnpm exec vitest run src/features/chat/graph/ExecutionGraphBoard.test.tsx src/features/chat/graph/executionGraphModel.test.ts src/features/chat/graph/ExecutionGraphView.test.tsx --reporter=verbose` from `apps/kalio-web` — passed (`22` tests)
- `pnpm exec tsc --noEmit` from `apps/kalio-web` — passed
- `pnpm exec playwright test --project=chromium tests/regression-talk-graph-entry.spec.ts` from `apps/e2e` — passed (`1` test)

## Notes
- The new board test now verifies translate-based panning directly instead of relying on scroll position.
- The new model test verifies that a dense turn node grows beyond the base height and pushes the next tool row down by its actual height plus the row gap.