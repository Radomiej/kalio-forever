# 2026-06-07 Embeddings And Preview Hardening

## Changed

- Local embeddings availability now resolves against the effective in-form config, not only the last persisted config.
- Switching back to local embeddings is blocked until the selected local model is actually ready.
- Settings polling, install/test state, and the `Use local` control now stay aligned with the currently selected local model.
- Context preview compaction now reports `applied: true` even when fallback truncation mutates content in place instead of only dropping message count.
- Context preview now surfaces `toolCalls` and `toolCallId`, and stale preview state remains visible after refresh failures.
- Session bootstrap in the web app now merges late `/api/sessions` responses with newer local state and avoids duplicate active-session identify replay on reconnect.

## Verification Evidence

- `corepack pnpm --filter kalio-api test -- --run src/modules/chat/__tests__/context-preview.service.spec.ts src/modules/memory/memory.controller.embedding.spec.ts`
- `corepack pnpm --filter kalio-web test -- --run src/features/chat/hooks/useContextPreview.test.ts src/features/chat/ContextStats.test.tsx src/features/settings/EmbeddingsPanel.test.tsx src/App.test.tsx`
- `corepack pnpm --filter kalio-api typecheck`
- `corepack pnpm --filter kalio-web typecheck`

## Live Readiness

This slice is live-ready for the affected runtime paths. The local embedding switch can no longer point at a missing model, and context preview state now reflects backend compaction and frontend refresh failures more honestly.

## Remaining Blockers

- The broader web-search rendering work in the dirty tree was not part of this slice and was intentionally left outside this commit.
- Full-stack manual QA for embeddings install/use flow and reconnect behavior was not rerun in browser automation during this slice.
