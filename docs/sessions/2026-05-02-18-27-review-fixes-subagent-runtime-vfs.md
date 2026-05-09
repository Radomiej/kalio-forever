# Review Fixes: Subagent Runtime And VFS

## What was done

- Re-audited the older review points against the current code after the recent subagent/session-state/image-runtime work.
- Removed the legacy direct-LLM fallback from `run_subagent`; the tool now requires the injected subagent runtime and fails loudly if it is unavailable.
- Added runtime regressions for subagent timeout enforcement and for `chat:complete` carrying the real persisted assistant `messageId`.
- Implemented timeout handling in `SubagentRuntimeService` with `Promise.race`, `AbortController`, child-session `chat:error`, and guaranteed `agent:done` emission on failure.
- Fixed `SubagentRuntimeService` so `chat:complete.messageId` points at the last assistant message persisted in the child session instead of the child session id.
- Hardened `VFSService.copySessionFiles()` so a single file disappearing between listing and copy no longer aborts the full copy-back.

## Files touched

- `apps/kalio-api/src/modules/tool/tools/subagent.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/subagent.tool.spec.ts`
- `apps/kalio-api/src/modules/chat/subagent-runtime.service.ts`
- `apps/kalio-api/src/modules/chat/__tests__/subagent-runtime.service.spec.ts`
- `apps/kalio-api/src/modules/vfs/vfs.service.ts`
- `apps/kalio-api/src/modules/vfs/vfs.service.spec.ts`

## Key decisions

- Treated the subagent runtime as mandatory infrastructure instead of keeping a silent fallback path that fabricated child-session metadata and bypassed the real orchestration loop.
- Kept timeout enforcement local to `SubagentRuntimeService` rather than widening the internal LLM source contract; current adapters still do not accept an abort signal directly.
- On runtime failure/timeout, emitted child-session `chat:error` plus `agent:done` so the frontend does not leave the child loop visually open.
- For VFS copy-back, only missing-file errors are skipped; other filesystem errors still propagate.

## Validation

- `pnpm --filter kalio-api test -- src/modules/tool/tools/subagent.tool.spec.ts`
- `pnpm --filter kalio-api test -- src/modules/chat/__tests__/subagent-runtime.service.spec.ts`
- `pnpm --filter kalio-api test -- src/modules/vfs/vfs.service.spec.ts`
- `pnpm --filter kalio-api test -- src/modules/tool/tools/subagent.tool.spec.ts src/modules/chat/__tests__/subagent-runtime.service.spec.ts src/modules/vfs/vfs.service.spec.ts`

## Findings

- The older `CanvasPanel` loop/dependency review item is no longer current after the recent per-session frontend rewrite.
- The older orchestrator image-tool review item is also already fixed by the recent persona/runtime/image work.
- The highest-confidence still-real backend issues from the old review were the runtime fallback, unused timeout, wrong `chat:complete.messageId`, and brittle VFS copy-back; these are now covered by targeted tests.

## Open questions

- `SubagentRuntimeService` still returns a normal result after `MAX_ITERATIONS`; unlike `ChatService`, it does not yet emit `MAX_ITERATIONS_REACHED` as a child-session error. That review point was not confirmed as a live regression in this slice and was left unchanged.