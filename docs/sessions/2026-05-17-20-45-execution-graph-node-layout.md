# Execution Graph Node Layout

## What was done
- Added local per-node layout overrides in the execution graph board.
- Enabled dragging graph nodes to custom positions without affecting board pan.
- Enabled resizing graph nodes from a corner handle.
- Removed fixed text line clamps inside graph cards so larger cards reveal more content.
- Added focused regression tests for drag and resize behavior.

## Files touched
- apps/kalio-web/src/features/chat/graph/ExecutionGraphBoard.tsx
- apps/kalio-web/src/features/chat/graph/ExecutionGraphPreview.tsx
- apps/kalio-web/src/features/chat/graph/ExecutionGraphBoard.test.tsx

## Decisions made
- Kept node layout state local to the board instead of persisting it into the graph model.
- Reused existing board zoom and edge path logic by applying runtime node overrides before rendering edges and cards.
- Used a simple resize handle plus document-level mouse tracking instead of introducing a drag/resize dependency.

## Open questions
- Node layout is not persisted across reloads yet.
- Touch interaction is still limited to existing board pan support; node drag/resize is mouse-driven.

## Next steps
- Persist node layout overrides if customized graph arrangement should survive session reloads.
- Add touch/pointer-level parity for node drag and resize if the graph is expected to be edited on tablets or touch devices.
