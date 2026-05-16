# 2026-05-16-16-48 - playwright autostart stack

## What was done

Moved E2E startup responsibility into Playwright itself so browser tests no longer require a manually started backend/frontend stack.

Implemented:
- `apps/e2e/scripts/start-playwright-stack.mjs` as the dedicated Playwright launcher.
- Backend autostart now builds `kalio-api` and runs `dist/main.js` against repo-root `.env.test` with the dedicated E2E env (`3316`, `kalio-e2e.db`, `workspaces-e2e`, mock LLM defaults).
- Frontend autostart now builds `kalio-web` and serves it with `vite preview` on `5288` instead of trying to run `vite dev` under Playwright.
- `apps/e2e/playwright.config.ts` now uses `webServer` so local and CI runs share the same startup path.
- `apps/e2e/package.json` now exposes `stack:playwright` for that launcher.
- `.github/workflows/ci.yml` E2E job now relies on Playwright autostart instead of manually starting API/web and waiting on them separately.

## Why this shape

- On Windows, Playwright `webServer` does not provide real console handles, which is unsafe for `vite dev` with Tailwind/Oxide.
- `vite preview` avoids that console-handle failure mode and is a closer fit for deterministic test automation than a hot-reload dev server.
- Keeping the launcher inside `apps/e2e` avoids a second startup path drifting away from the actual Playwright config.

## Validation

- Cold-start Playwright smoke: `tests/regression-port-config.spec.ts` - pass
  - Verified Playwright itself built and started backend/frontend before the spec ran.
- Cold-start UI spec: `tests/ac-14-session-creation.spec.ts` - pass
  - Verified browser-facing flow on the auto-started stack.

## Files touched

- `apps/e2e/scripts/start-playwright-stack.mjs`
- `apps/e2e/package.json`
- `apps/e2e/playwright.config.ts`
- `.github/workflows/ci.yml`

## Decisions

- Did not route Playwright autostart through `pnpm dev:e2e`; that path is still appropriate for manual interactive work, but not as the automated `webServer` backend on Windows.
- Did not kill arbitrary processes on the dedicated E2E ports from the Playwright launcher; if a server is already healthy, `reuseExistingServer` handles it, and if ports are occupied by something else the run should fail loudly.