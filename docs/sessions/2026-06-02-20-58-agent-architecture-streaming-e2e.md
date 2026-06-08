# 2026-06-02 20:58 - Agent Architecture streaming E2E stabilization

## Result

- Fixed reconstructed Architecture chat turns so in-flight runs are shown as `running` unless a persisted `architectureRun` snapshot or completed turn proves completion.
- Added deterministic fast mock LLM mode via `KALIO_MOCK_LLM_FAST=1`.
- Forced the Playwright E2E stack to use env LLM config and fast mock streaming with `KALIO_FORCE_ENV_LLM=1` and `KALIO_MOCK_LLM_FAST=1`.
- Updated the E2E stack launcher test to prove `.env.test` cannot pull E2E back into a paid/slow provider path.

## Evidence

- `npm.cmd --prefix apps/kalio-api run test -- src/modules/llm/providers/mock.provider.spec.ts`
  - 17 tests passed.
- `pnpm --filter @kalio/e2e test`
  - 12 tests passed, including the new env mock/fast streaming launcher guard.
- `npm.cmd --prefix apps/kalio-web run test -- src/features/chat/AgentTurnBubble.test.tsx src/features/chat/architectureChatSummary.test.ts`
  - 45 tests passed.
- `pnpm --filter @kalio/e2e test:e2e -- tests/architecture-chat-subagent-turn.spec.ts --project=chromium`
  - 2 Playwright tests passed.
  - Sequential route reached `Router -> Pragmatist -> Router -> Innovator -> Router -> Finalizer`.
  - Council branches restored after reload.
- `pnpm turbo run test`
  - 8 tasks successful.

## Remaining Risk

- Full Chromium E2E smoke (`pnpm --filter @kalio/e2e test:e2e -- --project=chromium`) did not complete within a 10 minute local tool timeout, so it is not a green proof.
- Earlier full smoke failures outside Architecture chat still need separate triage before claiming full E2E release readiness.
