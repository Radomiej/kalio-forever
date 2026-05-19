# Graph Mode Shell And Projection

## What was done
- Added a persistent `Graph` execution view mode inside Talk while keeping the existing `Conversation` mode intact.
- Extended the Talk shell state in `App.tsx` to remember the selected Talk view in session storage.
- Implemented the first `ExecutionGraphView` with a graph canvas, SVG edges, node selection, and a right-side inspector.
- Implemented a pure execution-graph projection layer that derives prompt, turn, tool, subagent, artifact, and final-answer nodes from the existing frontend stores.
- Added focused tests for App-level Talk view persistence and the execution-graph projection model.

## Files touched
- `apps/kalio-web/src/App.tsx`
- `apps/kalio-web/src/App.test.tsx`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphView.tsx`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.test.ts`

## Decisions
- Kept the implementation inside the existing Talk shell rather than adding a new top-level section.
- Started with a custom fixed-layout graph renderer instead of introducing React Flow immediately.
  - This keeps the first slice dependency-free.
  - The projection model is now separated, so swapping the renderer to React Flow later remains straightforward.
- Reused current runtime data instead of changing shared contracts or backend events.
- Chose subagent semantics where copied-file artifacts hang from the subagent node, not directly from the `run_subagent` tool node.
- Exposed `Timeline` only as a disabled target-state control for now; actual timeline rendering is not implemented yet.

## Validation
- `pnpm exec tsc --noEmit` in `apps/kalio-web` — passed
- `pnpm exec vitest run src/App.test.tsx src/features/chat/graph/executionGraphModel.test.ts --reporter=verbose` — passed

## Open follow-up
- Expand the graph beyond the current fixed layout into a more flexible renderer once branch density increases.
- Add richer child-session expansion so subagent internal tools can appear as first-class nodes.
- Implement the real `Timeline` renderer against the same execution-graph projection.
- Decide whether to replace the current custom renderer with React Flow in the next slice.