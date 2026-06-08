# 2026-06-05 Agent Runtime Audit Critical Fixes

## Scope

Audited AgentFlow/Architecture runtime stability after the MVP auditability work. The goal was to identify critical blockers that could make manual AgentFlow tests misleading, then fix only those blockers.

## Changes

- AgentFlow blocked snapshots caused by `flow:runtime_missing`, `flow:runtime_stalled`, or `flow:resume_failed` are now resumable from their durable checkpoint instead of becoming dead-end blocked runs.
- Credential completion smoke tests can use a requested model override even when the saved credential has an empty model field.
- Paid-readiness completion smoke now retries one transient Xiaomi MiFE cross-border `451` provider failure before failing the gate. Two consecutive provider failures still fail the gate.

## Verification

- `corepack pnpm --filter kalio-api exec vitest run src/modules/agent-flow/agent-flow-runtime.service.spec.ts src/modules/credentials/credentials.controller.spec.ts`
  - Passed: 2 test files, 79 tests.
- `node scripts\agentflow-paid-readiness.test.mjs`
  - Passed: 16 tests.
- `corepack pnpm --filter kalio-api run typecheck`
  - Passed.
- `npm.cmd run build`
  - Passed for packages, API, SDK, and web.
- `node scripts\agentflow-paid-readiness.mjs --api http://localhost:65310/api`
  - Provider/model checks passed.
  - Xiaomi completion smoke passed after the retry hardening.
  - Still blocked on missing Web Search / Perplexity configuration.

## Audit Findings

- Backend AgentFlow/Architecture unit coverage is strong around lifecycle, stale runtime handling, resume, stop, and graph execution.
- Frontend graph/chat tests cover the current rendering and settings paths, but this audit did not include a fresh Playwright visual run.
- Coverage should be read per app, not from partial targeted coverage runs. A partial API coverage command failed global thresholds because it only ran a subset of files.
- Coverage guardian reported current per-app coverage around backend 87.77 statements / 80.77 branches / 89.82 functions / 87.77 lines and frontend 80.74 statements / 73.65 branches / 79.60 functions / 82.58 lines.

## Remaining Blockers

- Paid/live AgentFlow readiness is not green until Web Search / Perplexity is configured.
- Full-stack AgentFlow proof still needs a live FE-started flow with real provider latency/failure behavior, not only unit tests and mock-stack E2E.
- Known weak test areas: `chat.gateway` edge/error paths, direct tool-arg-progress behavior, VFS hydration fallback without `filePaths`, and some Architecture role executor CLI preference/filtering branches.

## Current QA Stack

- Built QA stack was checked on backend `65310` and frontend `65311`.
- Official manual dev ports remain backend `3016` and frontend `5188`; random ports are for built QA stacks.
