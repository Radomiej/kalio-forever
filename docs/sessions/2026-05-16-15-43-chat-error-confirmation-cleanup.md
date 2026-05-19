# 2026-05-16 15:43 — chat:error confirmation cleanup

## What was done

- Investigated the reported "stuck" Orchestrator state and narrowed it to stale frontend session state, not a live backend loop: the turn had already ended with `chat:error`, but the UI still showed `Awaiting confirmation`.
- Added regressions in `ChatInterface.test.tsx` covering two failure-end states:
  - `chat:error` clears pending confirmation and settles active session tool activities as `error`
  - `chat:error` with `INTERRUPTED` settles active session tool activities as `cancelled`
- Updated `ChatInterface.tsx` so `offError` now:
  - clears `pendingConfirmations` for the errored session
  - removes the active loop for that session defensively
  - converts any `running` or `awaiting_confirmation` tool activities for that session into terminal states

## Files touched

- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`
- `apps/kalio-api/src/modules/llm/providers/mock.provider.ts`
- `apps/kalio-api/src/modules/llm/providers/mock.provider.spec.ts`
- `apps/e2e/tests/regression-mock-llm-429-recovery.spec.ts`

## Validation

- `pnpm --filter kalio-web exec vitest run src/features/chat/ChatInterface.test.tsx -t "chat:error clears pending confirmation"` — PASS
- `pnpm --filter kalio-web exec vitest run src/features/chat/ChatInterface.test.tsx` — PASS (`45` tests)
- `pnpm --filter kalio-api exec vitest run src/modules/llm/providers/mock.provider.spec.ts` — PASS
- `pnpm --filter kalio-api exec tsc --noEmit` — PASS
- `cd apps/e2e && pnpm exec playwright test --project=chromium tests/regression-mock-llm-429-recovery.spec.ts` — PASS
- editor diagnostics on `ChatInterface.test.tsx` — none
- `pnpm --filter kalio-web exec tsc --noEmit` — PASS
- live browser retest on `http://localhost:5188` via Quick Chat:
  - fresh session completed normally and rendered an assistant answer
  - `Active` tab showed `No active agent runs.` after turn completion
  - no orphaned pending-confirmation state remained visible in the shell

## Follow-up

- Added deterministic mock-provider failure support with the prompt token `[[mock:error:429]]`.
- This lets E2E tests reproduce a provider-style `LLM_ERROR` without waiting for a real remote quota failure or outage.
- The current mock support is intentionally narrow: it simulates a provider failure before any chunks. It does not yet script multi-step flows like `tool call -> tool result -> second-pass 429`.

## Decisions

- Kept the fix local to frontend event cleanup instead of patching badge rendering or session sidebar heuristics.
- Treated `chat:error` as a terminal turn event for UI state, even if `agent:done` should normally follow; this makes the UI resilient to dropped or reordered lifecycle events.
- Preserved tool history by settling active tool rows to `error` / `cancelled` instead of wiping them.

## Open questions

- I did not get a fresh real `429` during the final browser retest; the provider answered successfully on the live request, so the end-to-end check covered correct turn completion rather than the quota-exhausted branch.
- If we later want deterministic reproduction of a failure after tool execution, `MockLLMProvider` will need a slightly richer scripted-flow mode instead of the current single-trigger error token.