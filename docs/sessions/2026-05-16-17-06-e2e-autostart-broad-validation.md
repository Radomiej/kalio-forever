# 2026-05-16-17-06 - e2e autostart broad validation

## What was done

Validated the new Playwright-managed E2E startup path against a broader suite and fixed one remaining environment mismatch for DB-seeding specs.

Implemented:
- Added shared env defaults in `apps/e2e/playwright.config.ts` for:
  - `PLAYWRIGHT_BASE_URL`
  - `PLAYWRIGHT_API_ORIGIN`
  - `TEST_API_URL`
  - `DATABASE_PATH`
  - `WORKSPACE_ROOT`
  - `CREDENTIALS_MASTER_KEY`
- Kept the config compatible with Playwright's CJS-style config loading by resolving repo paths from `__dirname`, not `import.meta.url`.

## Root cause found

- The new Playwright `webServer` stack was healthy, but one DB-seeding regression spec still read the old fallback DB path (`kalio.db`) when `DATABASE_PATH` was not present in the Playwright test process.
- That let the spec seed one SQLite file while the auto-started backend used the dedicated E2E DB (`kalio-e2e.db`), so the seeded sessions were invisible in the UI.

## Validation

- Focused reproduction:
  - `tests/regression-chat-ordering-canvas-preview.spec.ts` initially failed against the auto-start stack due invisible seeded session rows.
  - After the Playwright env fix: pass.
- Broad chromium suite with auto-start and CI semantics: pass
  - `130 passed, 0 failed, 13 skipped`
- Full Playwright config with auto-start and CI semantics: pass
  - `147 passed, 0 failed, 13 skipped`

## Files touched

- `apps/e2e/playwright.config.ts`

## Decisions

- Did not patch the ordering spec itself because the mismatch was systemic, not local to that file.
- Kept the dedicated E2E defaults centralized in Playwright config so browser workers and the auto-start launcher share the same storage roots by default.