# Graph Tool Branch Layout And Zoom

## What was done
- Changed the graph projection so even a single tool call now renders below its parent turn instead of inline on the right.
- Changed board edge routing so edges into tool and tool-group nodes originate from the source node's bottom center, reserving right-side flow for reasoning/context progression.
- Enabled wheel-based zooming directly over the graph canvas.
- Made the graph canvas stretch to the available viewport when the projected board is smaller than the panel.
- Added a draggable separator so the right-side graph inspector can be widened or narrowed.
- Updated RAApp artifact preview extraction to prefer `renderedContent`, so preview-capable app nodes can show richer inline content.

## Files touched
- `apps/kalio-web/src/features/chat/graph/executionGraphBoard.tsx`
- `apps/kalio-web/src/features/chat/graph/executionGraphBoard.test.tsx`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.helpers.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.test.ts`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphView.tsx`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphView.test.tsx`

## Decisions
- Kept tool nodes as distinct nodes rather than collapsing them into edge labels; only their placement and edge anchor semantics changed.
- Used wheel zoom on the graph viewport itself instead of introducing another dedicated interaction mode.
- Implemented inspector resizing with a simple separator drag state in the view rather than introducing a generic split-pane dependency.
- Preferred `renderedContent` over `content` for RAApp previews because it better matches what users expect to see inside preview-capable nodes.

## Validation
- `pnpm exec vitest run src/features/chat/graph/ExecutionGraphBoard.test.tsx src/features/chat/graph/executionGraphModel.test.ts src/features/chat/graph/ExecutionGraphView.test.tsx --reporter=verbose` — passed (`15` tests)
- `pnpm exec tsc --noEmit` — passed
- `pnpm exec playwright test --project=chromium tests/regression-talk-graph-entry.spec.ts` from `apps/e2e` — passed
- Shared localhost browser verification:
  - wheel zoom changed the indicator from `100%` to `115%` after page reload
  - inspector width changed from `384px` to `508px` via the resize handle

## Notes
- The shared browser page reloaded into a simple single-prompt session, so visual verification of a richer multi-tool / RAApp-heavy graph remained mostly test-backed in this slice.
- View tests still emit existing React `act(...)` warnings from the async persona fetch effect, but they do not fail.