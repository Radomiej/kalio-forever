# Session Title Autogen Fix

## What was done

- Added a frontend regression test covering the case where the session title was already optimistically set from the first user prompt before the first assistant reply finished.
- Fixed `ChatInterface` so the first completed assistant reply still triggers `/api/sessions/:id/generate-title` when the current title matches the optimistic preview title.
- Kept the existing two-stage UX: immediate preview title on first send, followed by backend-generated replacement after the first reply completes.

## Files touched

- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`

## Decisions

- Did not remove the optimistic preview title update, because that would change visible UX more than necessary.
- Reused the same preview-title formatting logic in both the optimistic update and the trigger guard so the condition stays consistent.
- Scoped the fix to the first user/assistant exchange only, instead of broadening title regeneration across later turns.

## Validation

- Ran: `cd apps/kalio-web ; npx vitest run src/features/chat/ChatInterface.test.tsx`
- Result: all 49 tests passed.

## Open questions

- Backend `generateTitle` still derives the title from the first user message via truncation; despite the UI copy mentioning LLM generation, it is not currently model-generated.