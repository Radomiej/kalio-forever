# Scripts Overview

This folder contains workspace-level helper scripts. Keep command surface small:

## Core commands (daily)

- `pnpm dev` -> starts API + web via `start-dev.ps1`
- `pnpm build` -> Turbo build across workspaces
- `pnpm test` -> unit/integration + e2e preflight gate
- `pnpm test:e2e` -> Playwright e2e launcher
- `pnpm preflight` -> verify workspace links, .modules manifest, sqlite binding, and build outputs
- `pnpm repair` -> attempt repair/rebuild for preflight failures (uses repo-local .npm-cache/.node-gyp)

## Supporting commands (as needed)

- `pnpm typecheck` -> Turbo type checks
- `pnpm lint` -> Turbo lint checks
- `pnpm clean` -> cross-platform dist/tsbuildinfo cleanup
- `pnpm audit:report` -> static architecture audit + aggregated report
- `pnpm stack:start` -> run QA stack from built backend + vite preview --strictPort on allocated ports, using isolated QA database/workspace paths and mock LLM by default
- `pnpm stack:status` -> show running state + health checks
- `pnpm stack:stop` -> stop QA stack and cleanup process tree on Windows
- `pnpm llm:probe` -> test the running stack's active provider path without printing the API key; refuses non-local API URLs unless explicitly allowed

## Script map

- `run-test-gate.mjs` - workspace tests + e2e stack preflight
- `clean-paths.mjs` - cross-platform recursive cleanup helper
- `code-audit/*` - architecture/process audit tooling
- `repo-preflight.mjs` - repo integrity preflight + repair checks
- `stack-manager.mjs` - start/status/stop for built QA stack
- `probe-llm.mjs` - sanitized live provider probe through `/api/credentials/test`

Examples:

- `pnpm stack:start -- --use-env-llm --provider xiaomimimo --model mimo-v2.5 --base-url https://api.xiaomimimo.com/v1`
- `pnpm llm:probe -- --provider xiaomimimo --model mimo-v2.5-pro --base-url https://token-plan-ams.xiaomimimo.com/v1`
- `pnpm stack:status`
- `pnpm stack:stop`

Rule: before adding a new root command, verify it cannot be expressed with env vars or existing script arguments.
