## Summary

- Rebuilt `feature/raapp-v2` from `origin/main` by cherry-picking the 21 real commits after `origin/mvp-clean` instead of continuing a 323-commit rebase.
- Kept a safety backup branch at `backup/feature-raapp-v2-pre-cherry-2026-05-16` before resetting the feature branch onto `origin/main`.
- Restored PR-hardening work after the rewrite and fixed one typecheck regression in `settingsStore.test.ts`.
- Switched local E2E launcher flow to an explicit mock-LLM mode so Playwright no longer burns real provider tokens from `.env`.
- Hardened several Playwright specs for full-suite stability and made mock-incompatible assertions skip based on the backend's actual LLM config, not the Playwright process env.

## Files Touched

- `start-dev.ps1`
- `package.json`
- `apps/e2e/tests/helpers/test-config.ts`
- `apps/e2e/tests/ac-01-streaming.spec.ts`
- `apps/e2e/tests/ac-10-streaming-visible.spec.ts`
- `apps/e2e/tests/ac-11-tool-call-visible.spec.ts`
- `apps/e2e/tests/ac-13-anti-spam.spec.ts`
- `apps/e2e/tests/ac-13-multi-turn-history.spec.ts`
- `apps/e2e/tests/ac-raapp-ecs-live.spec.ts`
- `apps/kalio-web/src/features/settings/settingsStore.test.ts`

## Decisions

- Used `origin/mvp-clean..feature/raapp-v2` as the real delta range because `main` contains squash merges and the raw `main...feature` commit count was misleading.
- Added `pnpm dev:e2e` as the local launcher for mock-backed E2E and kept regular `pnpm dev` behavior unchanged for normal development.
- E2E mock detection now calls `/api/llm/config`; relying on `process.env.LLM_PROVIDER` inside Playwright was wrong when the backend was started from a separate shell.
- Two UX-level streaming assertions (`ac-01` first test, `ac-13` first test) are explicitly skipped under mock because the mock timing model is not a faithful signal for those transient disabled-state checks.
- Final PR-readiness signal was taken from `CI=true` Chromium Playwright, which matches the configured CI gate (`workers: 1`) and avoids local fully-parallel false negatives.

## Validation

- `pnpm exec vitest run src/features/landing/tileColors.test.ts src/features/landing/LandingPage.test.tsx` in `apps/kalio-web` passed.
- `pnpm turbo run typecheck --force` passed after fixing `apps/kalio-web/src/features/settings/settingsStore.test.ts`.
- `Invoke-RestMethod http://localhost:3016/api/llm/config` on `pnpm dev:e2e` reported `provider: mock`, `source: env`.
- Mock-sensitive Playwright slice passed/skipped as expected: 4 passed, 3 skipped.
- `CI=true pnpm exec playwright test --project=chromium` in `apps/e2e` passed with 142 passed and 16 skipped.

## Open Items

- The current local branch history is rewritten relative to `origin/feature/raapp-v2`; pushing this branch will require a force-push.
- One stash entry remains as a safety copy from the abandoned rebase flow: `copilot-temp-rebase-2026-05-16`.