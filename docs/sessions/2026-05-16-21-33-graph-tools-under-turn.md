# Graph Tools Under Turn

## What was done
- Tightened the execution-graph layout so tool nodes no longer drift into the next column.
- Changed both expanded tool nodes and collapsed tool-group nodes to stay in the same column as their parent turn.
- Changed multi-tool placement so later tools are no longer pushed downward by outcomes from earlier tools; the tool list now stays compact directly under the turn.
- Kept outcomes, subagent context, and child-flow progression on the right-hand columns.

## Files touched
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.test.ts`

## Decisions
- Preserved the semantic split: downward flow = concrete tool calls, rightward flow = reasoning/context/results.
- Fixed the issue at the projection layer instead of compensating in the board renderer.
- Left board edge routing unchanged for non-tool progression; only tool placement semantics were adjusted.

## Validation
- `pnpm exec vitest run src/features/chat/graph/executionGraphModel.test.ts --reporter=verbose` — passed
- `pnpm exec vitest run src/features/chat/graph/ExecutionGraphBoard.test.tsx src/features/chat/graph/executionGraphModel.test.ts src/features/chat/graph/ExecutionGraphView.test.tsx --reporter=verbose` — passed (`15` tests)
- `pnpm exec tsc --noEmit` — passed

## Notes
- Shared browser verification was limited by the active localhost page repeatedly reloading back into a simpler prompt-only session, so the rich multi-tool visual confirmation for this exact slice remained primarily test-backed.