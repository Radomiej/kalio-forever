# Anti-spam E2E determinism

## What was done

- Reproduced the failing `apps/e2e/tests/ac-13-anti-spam.spec.ts` locally with the same CI-style environment as the GitHub Actions `e2e` job.
- Confirmed the flaky path was caused by the mock LLM finishing too quickly for the first anti-spam scenario, which let the second forced click happen after the first turn had already completed.
- Updated the anti-spam E2E prompts to use a longer echoed message so the streaming window stays open long enough for the disabled-input and blocked-resubmit assertions to execute deterministically.

## Files touched

- `apps/e2e/tests/ac-13-anti-spam.spec.ts`

## Decisions made

- Kept the fix scoped to the E2E test because the frontend already has a local send lock and the existing failure was timing-dependent under the mock provider.
- Reused the mock provider’s echo behavior instead of changing backend timing globally, to avoid broad side effects across other tests.

## Validation

- `corepack pnpm --filter @kalio/e2e exec playwright test tests/ac-13-anti-spam.spec.ts --project=chromium --repeat-each=5`
- `corepack pnpm --filter @kalio/e2e exec playwright test tests/ac-01-streaming.spec.ts tests/ac-13-anti-spam.spec.ts --project=chromium`

## Open questions

- The root `pnpm turbo run lint` command still fails before any changes because the current ESLint invocation expects a flat config file that is not present.

## Next steps

- Run final review/security validation for the test-only change and land the E2E stabilization.
