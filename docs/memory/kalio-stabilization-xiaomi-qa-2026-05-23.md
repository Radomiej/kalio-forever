# Kalio Stabilization + Xiaomi QA Memory - 2026-05-23

## PM Summary

- Stabilization harness is verified: preflight, typecheck, root test gate, launcher tests, full E2E, and managed stack lifecycle all pass.
- E2E now owns backend/frontend startup, allocates random ports, uses per-run SQLite/workspace paths, and runs built web through `vite preview --strictPort`.
- Manual dev ports `3016/5188` are only for `start-dev.ps1`. E2E must not depend on `3016/3316/5188/5288`.
- QA stack defaults to mock LLM and isolated QA storage. Live provider QA requires explicit `--use-env-llm`.

## Verified Commands

- `node scripts\repo-preflight.mjs` -> pass
- `corepack pnpm run typecheck` -> pass
- `corepack pnpm run test` -> pass
- `node --test .\apps\e2e\scripts\start-playwright-stack.test.mjs` -> 11 passed
- `corepack pnpm run test:e2e` -> 135 passed, 16 skipped
- `corepack pnpm run stack:start -- --skip-build --backend-port 0 --frontend-port 0` -> pass
- `corepack pnpm run llm:probe -- --provider mock --model mock --base-url mock` -> pass

## Current Blocker

Live Xiaomi MiMo 2.5 provider validation is blocked by credentials.

Latest re-check:

- Command: `corepack pnpm run stack:start -- --skip-build --backend-port 0 --frontend-port 0 --use-env-llm --provider xiaomimimo --model mimo-v2.5-pro --base-url https://token-plan-ams.xiaomimimo.com/v1`
- Stack: started healthy on random ports.
- Probe: `corepack pnpm run llm:probe -- --provider xiaomimimo --model mimo-v2.5-pro --base-url https://token-plan-ams.xiaomimimo.com/v1`
- Result: `401 Unauthorized`, `Invalid API Key`.

## Next PM Loop

Start with the provider gate, not with broad test debugging:

```powershell
corepack pnpm run stack:start -- --skip-build --backend-port 0 --frontend-port 0 --use-env-llm --provider xiaomimimo --model mimo-v2.5-pro --base-url https://token-plan-ams.xiaomimimo.com/v1
corepack pnpm run llm:probe -- --provider xiaomimimo --model mimo-v2.5-pro --base-url https://token-plan-ams.xiaomimimo.com/v1
corepack pnpm run stack:stop
```

If the probe passes, continue with `docs/QA/xiaomi-mimo-2.5-manual-qa.md` and verify live chat, graph readability, persona/subagent usage, design page generation, custom RAApp generation, and native tool behavior.
