# Session: Playwright Stack CI Env File

**Date**: 2026-05-19  
**Topic**: Fixing Playwright `webServer` startup in CI when `.env.test` is absent

## What Was Done

Added a focused regression test for the Playwright launcher and fixed the stack bootstrap so CI no longer depends on a repo-root `.env.test` file.

### Root cause

`apps/e2e/scripts/start-playwright-stack.mjs` spawned the backend as:

`node --env-file=<repo>/.env.test dist/main.js`

When `.env.test` was missing in CI, Node exited before Nest started, so Playwright never connected to the `webServer` target.

### Fixes Applied

**`apps/e2e/scripts/start-playwright-stack.mjs`**
- Added optional `.env.test` loading with `process.loadEnvFile()` guarded by `existsSync()`
- Removed `--env-file=...` from the backend spawn command

**`apps/e2e/scripts/start-playwright-stack.test.mjs`**
- Added a Node test that copies the launcher into a temporary sandbox repo
- The sandbox omits `.env.test`, provides fake `pnpm` build/preview commands, and starts a fake backend
- The test asserts the launcher still reaches `backend and frontend are ready`

**`apps/e2e/package.json`**
- Added a `test` script for the launcher regression test

## Files Touched

- `apps/e2e/scripts/start-playwright-stack.mjs`
- `apps/e2e/scripts/start-playwright-stack.test.mjs`
- `apps/e2e/package.json`

## Validation

### Red

`pnpm --filter @kalio/e2e test`

Failed before the fix with:

- `...\.env.test: not found`
- `[playwright-stack] backend exited unexpectedly with code 9`

### Green

`pnpm --filter @kalio/e2e test`

Passed after the fix.

`$env:CI="true"; pnpm --filter @kalio/e2e exec playwright test tests/regression-port-config.spec.ts --project=chromium`

Passed and confirmed both dedicated E2E ports respond under the real Playwright `webServer` path.

## Decisions

- Used Node 22's `process.loadEnvFile()` instead of adding new loader glue because the repo already requires Node 22 and the API does not overwrite existing CI-provided env vars.
- Kept `.env.test` optional rather than CI-only gated so local runs still benefit from the file when present.

## Open Questions

- None for this fix.