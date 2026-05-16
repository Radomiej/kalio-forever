# Graph Subagent Context Layout

## What was done
- Changed the graph projection so `run_subagent` branches no longer drop into an extra staircase row before the child agent flow starts.
- Reused the existing `subagent` node as a context-bearing branch root that now shows the orchestrator-provided prompt (`inputPrompt`) instead of only model/VFS metadata.
- Started the first child turn on the same row as the subagent context node, so the child agent reads like a new root flow rather than a nested tool outcome.
- Added inspector support for the subagent context prompt.

## Files touched
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.helpers.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphModel.test.ts`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphView.tsx`

## Decisions
- Kept the existing `subagent` node kind instead of adding a brand new `context` node type, to avoid widening the board/view surface for a still-evolving UX.
- Derived subagent context from existing tool args (`inputPrompt`, with fallbacks) so the UI change stayed frontend-only.
- Flattened the layout by shifting the subagent node one row up relative to the previous tool-outcome slot and anchoring the child turn from that row.

## Validation
- `pnpm exec vitest run src/features/chat/graph/executionGraphModel.test.ts --reporter=verbose` — passed
- `pnpm exec vitest run src/features/chat/graph/executionGraphModel.test.ts src/features/chat/graph/ExecutionGraphView.test.tsx --reporter=verbose` — passed
- `pnpm exec tsc --noEmit` — passed

## Notes
- Manual localhost verification confirmed the Talk graph still renders and the Conversation view still exposes user prompt, LLM reply, and thinking text on the active session.
- The shared browser page did not have an easily clickable rich subagent session in the constrained viewport, so the new flattened subagent layout was validated primarily via model tests rather than a full visual end-to-end capture.