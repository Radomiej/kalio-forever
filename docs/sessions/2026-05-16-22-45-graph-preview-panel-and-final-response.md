# Graph Preview Panel And Final Response

## What was done
- Added a reusable graph preview adapter so preview-capable graph nodes can expose the same RAApp rendering pipeline used in chat.
- Added miniature preview thumbnails inside preview-capable graph nodes.
- Added a right-side live preview panel in the graph inspector for the selected node.
- Changed artifact extraction to preserve enough session/path context for VFS-backed HTML previews.
- Locked graph cards to the model height and increased row spacing so richer node content does not visually overlap adjacent rows.
- Finalized the terminal chat node semantics as `Final response` on the right side of the graph without dashed tool-to-final links.

## Files touched
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphPreview.tsx`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphBoard.tsx`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphBoard.test.tsx`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphView.tsx`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphView.test.tsx`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.helpers.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.test.ts`

## Decisions
- Reused the existing chat preview stack instead of building a separate graph-specific renderer.
- Kept miniature node previews intentionally small and read-only so the graph remains legible while the inspector hosts the functional preview.
- Treated the final assistant reply as a first-class terminal node rather than a derived tool outcome.
- Fixed the overlap issue at the layout contract level by keeping rendered card height aligned with the board projection grid.

## Validation
- `pnpm exec vitest run src/features/chat/graph/ExecutionGraphBoard.test.tsx src/features/chat/graph/executionGraphModel.test.ts src/features/chat/graph/ExecutionGraphView.test.tsx --reporter=verbose` from `apps/kalio-web` — passed (`19` tests)
- `pnpm exec tsc --noEmit` from `apps/kalio-web` — passed
- `pnpm exec playwright test --project=chromium tests/regression-talk-graph-entry.spec.ts` from `apps/e2e` — passed (`1` test)

## Notes
- Shared localhost verification on the reused browser page still proved flaky after reload because the page often reset back to a simple coffee prompt session.
- I was able to reselect the richer calculator session again, but the built-in screenshot tooling in the integrated browser captured only a clipped portion of the graph inspector instead of a useful full-canvas frame.
- View tests still emit the existing React `act(...)` warnings from the async persona fetch path, but they do not fail.