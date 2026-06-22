# 2026-06-22 Release Gate And QA Readiness

## Scope

- Finish the dev/QA hardening slice for chat and architecture workflow observability.
- Prove reconnect hydration in a real browser on the fixed QA stack.
- Close the missing AC-02 HITL confirmation coverage.
- Leave the fixed QA stack ready for manual user testing.

## Changes

- Added [apps/e2e/tests/chat-reconnect-hydration.spec.ts](/C:/Projekty/kalio-forever/apps/e2e/tests/chat-reconnect-hydration.spec.ts) to prove browser offline -> backend mutation -> reconnect -> stale confirmation cleanup without page reload on fixed QA.
- Unskipped and implemented the remaining AC-02 tests in [apps/e2e/tests/ac-02-hitl-confirmation.spec.ts](/C:/Projekty/kalio-forever/apps/e2e/tests/ac-02-hitl-confirmation.spec.ts):
  - confirm executes the mock `vfs_write`,
  - cancel leaves the file absent and shows cancelled UI,
  - tool target and expanded args are visible.
- Extended [scripts/workflow-release-gate.mjs](/C:/Projekty/kalio-forever/scripts/workflow-release-gate.mjs) with a dedicated reconnect/hydration live gate and removed the mock-only HITL runtime spec from the live QA gate.
- Stabilized live Playwright timing in [apps/e2e/tests/architecture-chat-subagent-turn.spec.ts](/C:/Projekty/kalio-forever/apps/e2e/tests/architecture-chat-subagent-turn.spec.ts) and [apps/e2e/tests/ac-10-streaming-visible.spec.ts](/C:/Projekty/kalio-forever/apps/e2e/tests/ac-10-streaming-visible.spec.ts) so the release gate matches actual live-provider latency.

## Verification

- Isolated mock-stack AC-02 proof passed:
  - `corepack pnpm --filter @kalio/e2e run test:e2e -- tests/ac-02-hitl-confirmation.spec.ts --project=chromium`
- Live fixed-QA reconnect proof passed:
  - `corepack pnpm --filter @kalio/e2e exec playwright test tests/chat-reconnect-hydration.spec.ts --project=chromium`
    with `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5288`, `PLAYWRIGHT_API_ORIGIN=http://127.0.0.1:3316`, `TEST_API_URL=http://127.0.0.1:3316/api`, `KALIO_PLAYWRIGHT_EXTERNAL_SERVER=1`
- Live fixed-QA release gate passed:
  - `npm.cmd run release:workflow-gate -- --require-live`

## QA Stack

- Fixed QA remains the manual test target:
  - frontend: `http://127.0.0.1:5288`
  - backend: `http://127.0.0.1:3316`
- Live provider at verification time:
  - provider `xiaomimimo`
  - model `mimo-v2.5`
  - source `db`

## Remaining Risks

- The long architecture live proof is still expensive and can take a few minutes on the live provider even after timing stabilization.
- Full confirm/cancel HITL proof depends on the isolated env-mock Playwright stack by design; the fixed QA live stack is intentionally DB-backed and should not be forced into mock mode for release gating.
