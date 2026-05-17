# Session Title Autogen Fix

## What was done

- Added a frontend regression test covering the case where the session title was already optimistically set from the first user prompt before the first assistant reply finished.
- Added a Playwright AC-21 UI test that creates a real session from the sidebar, sends the first message, and verifies the title upgrades from `New Chat` to the optimistic preview and then to the backend-generated final title.
- Fixed `ChatInterface` so title generation runs from `chat:complete` instead of relying on a `chat:chunk` terminal event that the backend does not emit on the real wire flow.
- Relaxed the title-generation guard from exactly one assistant message to at least one assistant message so first turns that span multiple assistant iterations still qualify.
- Kept the existing two-stage UX: immediate preview title on first send, followed by backend-generated replacement after the first reply completes.

## Files touched

- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`
- `apps/e2e/tests/ac-21-session-title.spec.ts`

## Decisions

- Did not remove the optimistic preview title update, because that would change visible UX more than necessary.
- Reused the same preview-title formatting logic in both the optimistic update and the trigger guard so the condition stays consistent.
- Moved the backend title request to `chat:complete`, because that is the actual per-turn completion event the frontend can rely on in production.
- Scoped the fix to the first user turn by requiring exactly one user message and at least one assistant message, which still covers multi-step first turns without broadening regeneration across later turns.

## Validation

- Ran: `cd apps/kalio-web ; npx vitest run src/features/chat/ChatInterface.test.tsx`
- Result: all 49 tests passed.
- Ran: `cd apps/e2e ; $env:CI='1' ; $env:PLAYWRIGHT_BASE_URL='http://localhost:5388' ; $env:PLAYWRIGHT_API_ORIGIN='http://localhost:3416' ; $env:TEST_API_URL='http://localhost:3416/api' ; npx playwright test tests/ac-21-session-title.spec.ts`
- Result: both AC-21 tests passed, including the new end-to-end sidebar title upgrade scenario.

## Open questions

- Backend `generateTitle` still derives the title from the first user message via truncation; despite the UI copy mentioning LLM generation, it is not currently model-generated.