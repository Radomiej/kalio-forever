# Graph Card Polish And Sizing Profiles

## What was done
- Replaced the single generic node-height heuristic with per-kind sizing profiles for prompt, turn, tool-group, tool, subagent, artifact, and final-response nodes.
- Increased the space budget for preview-heavy tool nodes so embedded preview thumbnails no longer feel cramped or clipped by the old hard cap.
- Kept subagent cards more generous than ordinary turns so long orchestration context reads as a primary branch, not as another small tool chip.
- Added human-readable metadata labels for common tool args like `inputPrompt`, `filePath`, and `vfsMode`.
- Refined graph card typography and color accents so eyebrow, headline, supporting text, and metadata chips are visually separated.
- Switched metadata chip layout to one or two columns depending on content density and preview presence.

## Files touched
- `apps/kalio-web/src/features/chat/graph/executionGraphNodePresentation.ts`
- `apps/kalio-web/src/features/chat/graph/executionGraphNodePresentation.test.ts`
- `apps/kalio-web/src/features/chat/graph/ExecutionGraphBoard.tsx`

## Decisions
- Kept the sizing logic in the presentation helper instead of pushing more UI-specific rules into the execution graph model.
- Used explicit per-kind caps and bonuses rather than trying to infer everything from raw text length alone.
- Preserved deterministic layout by keeping all height estimation pure and testable; no DOM measurement was introduced.
- Reused the existing graph preview thumbnail instead of changing the preview renderer surface.

## Validation
- `pnpm exec vitest run src/features/chat/graph/executionGraphNodePresentation.test.ts src/features/chat/graph/ExecutionGraphBoard.test.tsx src/features/chat/graph/executionGraphModel.test.ts src/features/chat/graph/ExecutionGraphView.test.tsx --reporter=verbose` from `apps/kalio-web` — passed (`25` tests)
- `pnpm exec tsc --noEmit` from `apps/kalio-web` — passed
- `pnpm exec playwright test --project=chromium tests/regression-talk-graph-entry.spec.ts` from `apps/e2e` — passed (`1` test)

## Notes
- The new unit test file pins the exact polish goals for this slice: stronger subagent sizing, larger preview-heavy tool cards, and friendlier metadata labels.
- The existing `ExecutionGraphView` tests still pass without changing their surface API.