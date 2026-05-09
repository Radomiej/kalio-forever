# Subagents MVP manual verification and canvas fix

## What was done

- Finished live verification of the subagent MVP on the restarted dev stack.
- Verified `/api/personas` after restart and confirmed `web-research` and `orchestrator` are seeded in the running backend.
- Reproduced a real UI regression: completed subagent runs created child sessions and fetched child transcripts, but the right canvas hid the `Sub-agents` preview section after the loop finished.
- Added a focused regression test for completed subagent previews with `activeAgentLoops = {}`.
- Fixed `CanvasPanel` to render subagent preview cards whenever `subagentPreviews.length > 0`, not only while a loop is still active.
- Re-ran live nested subagent flow and confirmed the canvas now shows:
  - child transcript preview,
  - copied VFS output path,
  - `Open` action that jumps to the child conversation.

## Files touched

- `apps/kalio-web/src/features/chat/CanvasPanel.tsx`
- `apps/kalio-web/src/features/chat/CanvasPanel.test.tsx`

## Decisions

- Kept the fix minimal and local: the bug was a render condition, not missing fetches or broken API payloads.
- Left canvas preview reconstruction as runtime-state-only behavior for now.
  - After full page reload, `toolActivities` are gone, so subagent preview cards are not reconstructed from persisted chat history.
  - This is acceptable for MVP because the live canvas is intended as an active-run viewer, not yet a durable historical subagent explorer.

## Validation

### Focused automated

- `pnpm vitest run src/features/chat/CanvasPanel.test.tsx`
  - added failing regression first,
  - then passed after the render-condition fix.

- `./node_modules/.bin/tsc.CMD --noEmit` in `apps/kalio-web`
  - passed with no output.

### Manual live verification

- Dev stack running from `start-dev.ps1`:
  - API: `http://localhost:3016`
  - Web: `http://localhost:5188`

- Persona check:
  - `/api/personas` returned both `web-research` and `orchestrator`.

- Nested subagent scenario in UI using `orchestrator` persona:
  - master session spawned a delegating subagent,
  - delegating subagent spawned one nested child,
  - nested child created `index.html` in isolated VFS,
  - copied file path surfaced in master flow,
  - sidebar showed nested subagent conversations,
  - canvas displayed transcript snippets and VFS output path,
  - `Open` in the canvas switched the UI to the child conversation.

## Remaining risk

- Canvas subagent preview is not reconstructed after a hard reload because it depends on in-memory `toolActivities` rather than persisted history. If persistent historical preview becomes required, the next step is to derive preview cards from saved tool-result messages or persisted agent-turn metadata.

## Follow-up: reload reconstruction

- Implemented the next-step fix for the remaining canvas limitation.
- `CanvasPanel` now reconstructs subagent preview cards from persisted `tool_result` history in the active session, not only from in-memory `toolActivities`.
- This means a hard reload no longer drops the subagent preview section as long as the loaded session history contains `run_subagent` results and the child sessions still exist.

### Additional validation

- `pnpm vitest run src/features/chat/CanvasPanel.test.tsx`
  - includes a dedicated reload regression where `toolActivities = []` and `activeAgentLoops = {}` but history still contains the serialized `run_subagent` tool result.

- `./node_modules/.bin/tsc.CMD --noEmit` in `apps/kalio-web`
  - passed after the reload reconstruction change.