# E2E build unblock and launcher coverage

## What was done
- Investigated the reported E2E breakage by running the Playwright suite in CI-like mode.
- Found that E2E specs were not failing on UI behavior; the suite was blocked before startup by a backend TypeScript error in a newly added test fixture.
- Fixed the blocking DTO fixture in `apps/kalio-api/src/modules/mcp/mcp.controller.spec.ts` by adding the required `transport` field.
- Re-ran the backend build and the full Playwright suite after the fix.
- Verified the critical E2E startup logic in `apps/e2e/scripts/start-playwright-stack.mjs` with Node test coverage.

## Files touched
- apps/kalio-api/src/modules/mcp/mcp.controller.spec.ts

## Decisions
- Kept the fix surgical: no E2E spec changes were needed because the root cause was build-time, not browser-time.
- Treated the Playwright launcher as the key logic slice for this task because E2E stability depends on it and it already has a dedicated narrow test harness.

## Verification
- `cd apps/kalio-api && pnpm build`
- `cd apps/e2e && $env:CI='true'; pnpm test:e2e`
- `cd apps/e2e && node --experimental-test-coverage --test scripts/start-playwright-stack.test.mjs`

## Result
- `kalio-api` build passed after the DTO fix.
- Full Playwright suite passed in CI mode: 18/18 specs green.
- Coverage for the key E2E launcher logic (`start-playwright-stack.mjs`) measured at 100% in the focused Node coverage run.

## Open questions
- None for this fix. Remaining E2E work would be additive coverage of new product flows, not stability repair.