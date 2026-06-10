# Command Surface Audit (2026-05-22)

## Goal

Keep project operations centered on four commands: `dev`, `build`, `test`, `test:e2e`.

## Inventory summary

| Area | Commands | Keep? | Why |
|---|---|---|---|
| Root | `dev`, `build`, `test`, `test:e2e` | Yes | Core developer flow |
| Root | `typecheck`, `lint`, `clean` | Yes | CI and local quality gates |
| Root | `audit`, `audit:report` | Yes | Existing CI/static governance checks |
| Root | `dev:e2e` | Yes (optional) | Dedicated mock/e2e local stack |
| App/package-local | `test:watch`, `test:cov`, DB scripts, preview | Yes (optional) | Useful focused workflows, not part of core flow |

## Cleanup done in this run

1. Replaced Unix-only `rm -rf` clean scripts with cross-platform Node helper:
   - `scripts/clean-paths.mjs`
   - updated `clean` scripts in `apps/kalio-api`, `apps/kalio-web`, `packages/@kalio/sdk`, `packages/@kalio/types`
2. Fixed README run command typo:
   - `apps/kalio-api && pnpm start:dev` -> `apps/kalio-api && pnpm dev`
3. Added script usage map:
   - `scripts/README.md`

## GitHub CLI vs Copilot CLI check

- `gh` is still active and maintained (GitHub CLI repo releases continue in 2026).
- Copilot CLI is also current and documented by GitHub.
- Recommendation: keep repo scripts independent of either tool; use either client only for contributor workflows, not boot/build/test execution.

## Follow-up (2026-06-10)

The core four commands (`dev`, `build`, `test`, `test:e2e`) are unchanged. Additional **QA / stack** commands were added since this audit:

| Command | Role |
|---|---|
| `pnpm qa` / `pnpm qa:rebuild` | Fixed-port built stack (`3316` / `5288`), AppData profile |
| `pnpm qa:status` / `pnpm qa:stop` | Lifecycle for fixed QA stack |
| `pnpm stack:start` / `stack:status` / `stack:stop` | Managed built stack, random ports, repo `data/kalio-qa.db` |
| `pnpm llm:probe` | Probe running stack provider via `/api/credentials/test` |
| `pnpm preflight` / `pnpm repair` | Workspace integrity |
| `pnpm agentflow:paid-readiness` | Gate before paid AgentFlow runs |

Canonical documentation: **[docs/local-dev-guide.md](./local-dev-guide.md)**.
