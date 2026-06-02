# Xiaomi MiMo 2.5 QA Evidence - 2026-05-23

## Result

The stabilization harness is verified for non-live QA. Live Xiaomi validation is still blocked by provider authentication: the backend reaches Xiaomi, but Xiaomi returns `401 Invalid API Key`.

## Verified Gates

| Gate | Result | Evidence |
|---|---:|---|
| Repo preflight | Pass | `node scripts\repo-preflight.mjs` -> `[preflight] all checks passed` |
| Typecheck | Pass | `corepack pnpm run typecheck` |
| Root test gate | Pass | `corepack pnpm run test` -> types 7, API 1484, web 587, launcher 11 |
| E2E launcher tests | Pass | `node --test .\apps\e2e\scripts\start-playwright-stack.test.mjs` -> 11 passed |
| Full E2E | Pass | `corepack pnpm run test:e2e` -> 135 passed, 16 skipped |
| Focused non-live web QA | Pass | graph/RAApp/settings/tool bubble suite -> 8 files, 56 tests |
| Focused non-live API QA | Pass | persona/subagent/design/RAApp/native/CLI suite -> 16 files, 190 tests |
| Managed stack lifecycle | Pass | `stack:start -- --skip-build --backend-port 0 --frontend-port 0`, `stack:status`, `llm:probe`, `stack:stop` |
| Probe remote URL guard | Pass | `probe-llm` refused `https://example.com/api` before sending credentials |

## Stabilization Evidence

| Area | Status | Notes |
|---|---:|---|
| E2E ports | Pass | `pnpm test:e2e` allocates random frontend/backend ports and rejects legacy `3016/3316/5188/5288` by default. |
| E2E storage | Pass | The wrapper creates a per-run `data/playwright-stack/<run-id>/kalio-e2e.db` and workspace root, then passes those paths to both backend and Playwright. |
| QA stack | Pass | Defaults to mock LLM plus `data/kalio-qa.db` and `data/workspaces-qa`; live provider requires explicit `--use-env-llm` or provider flags. |
| Secret safety | Pass | `llm:probe` refuses non-local API URLs by default and sanitizes provider errors before printing. |
| Native repair | Pass | Preflight verifies workspace links, `.modules.yaml`, shared package outputs, and `better-sqlite3` in-memory binding. |
| Windows process handling | Pass | Stack manager records PID/state/logs and stops backend/frontend process trees. |

## Xiaomi Live Blocker

| Check | Result |
|---|---|
| Provider | `xiaomimimo` |
| Model | `mimo-v2.5-pro` |
| Base URL | `https://token-plan-ams.xiaomimimo.com/v1` |
| Probe result | `ok: false` |
| Error | `401 Unauthorized`, `Invalid API Key` |

This means live chat, persona/subagent chains, design-page generation, RAApp generation, and native-tool LLM behavior cannot be truthfully certified against Xiaomi until the key is replaced.

## Manual UI Smoke Already Observed

| Surface | Status | Notes |
|---|---:|---|
| Chat shell | Partial | UI sends through the stack; Xiaomi turn fails with `401 Invalid API Key`. |
| Graph readability | Pass | Graph view rendered with readable nodes and edges in manual browser smoke. |
| RAApp catalog | Pass | RAConsierge / RAApp catalog rendered. |
| Tools surface | Pass | Native tool list rendered with expected tool registry entries. |
| CLI agents settings | Pass | CLI-agent settings panel rendered. |
| Xiaomi model display | Pass | Settings displayed Xiaomi MiMo `mimo-v2.5-pro`. |

## Remaining Risk

| Risk | Why it matters | Next step |
|---|---|---|
| Xiaomi key invalid | Blocks all live provider paths. | Replace the key, then run `pnpm stack:start -- --use-env-llm --provider xiaomimimo --model mimo-v2.5-pro --base-url https://token-plan-ams.xiaomimimo.com/v1` and `pnpm llm:probe -- --provider xiaomimimo --model mimo-v2.5-pro --base-url https://token-plan-ams.xiaomimimo.com/v1`. |
| Free-port race remains theoretically possible | Free ports are allocated before child processes bind. | Add retry-on-bind-failure if this appears in CI/local logs. Current full E2E passed. |
| Playwright browser launch needs non-sandbox execution | The sandbox blocks Chromium with `spawn EPERM`. | Keep Playwright commands approved outside sandbox on Windows. |
