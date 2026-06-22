# 2026-06-22 OpenRouter Default Release Proof

## What changed

- Unified the shared OpenRouter release default on `cohere/north-mini-code:free` in `scripts/llm-provider-config.mjs`.
- Kept the provider-mismatch guard for generic `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` and aligned release-facing tests/docs with the verified OpenRouter model.
- Added a fixed-QA external Playwright proof that launches `Architecture Debate` from the welcome screen with `projectPath=C:\Projekty\kalio-forever`, waits for the live workflow to complete, verifies repo-scoped child transcripts do not contain `ACCESS_DENIED`, and reopens the workflow after reload.

## Why

- The repo already had live-release evidence that `cohere/north-mini-code:free` passed the Architecture Debate gate, while `nvidia/nemotron-3-ultra-550b-a55b:free` timed out.
- Shared activation/probe defaults were still on the timed-out NVIDIA model, so a fresh live activation could silently regress release QA onto the wrong OpenRouter target and recreate a false live blocker.

## Verification

- `node --test scripts/activate-live-credential.test.mjs scripts/llm-provider-config.test.mjs scripts/agentflow-paid-readiness.test.mjs`
- `node scripts/activate-live-credential.mjs --api-url http://127.0.0.1:3316/api --provider openrouter --model cohere/north-mini-code:free --base-url https://openrouter.ai/api/v1`
- `node scripts/probe-llm.mjs --api-url http://127.0.0.1:3316/api --provider openrouter --model cohere/north-mini-code:free --base-url https://openrouter.ai/api/v1`
- `corepack pnpm --filter @kalio/e2e exec playwright test tests/architecture-chat-subagent-turn.spec.ts --project=chromium --grep "renders council branches as sub-agent chips and restores them after reload|launches Architecture Debate from the welcome screen with projectPath and keeps child transcripts repo-scoped after reload"`
- `corepack pnpm --filter @kalio/e2e exec playwright test tests/ac-26-history-reload.spec.ts tests/chat-reconnect-hydration.spec.ts tests/workflow-stop-runtime.spec.ts --project=chromium`
- `npm.cmd run agentflow:paid-readiness -- --api http://127.0.0.1:3316/api`
- `npm.cmd run release:workflow-gate`

## Result

- Fixed QA `3316/5288` now reports `/api/llm/config -> openrouter / cohere/north-mini-code:free / db`.
- Live OpenRouter probe is green.
- Architecture workflow baseline passes on fixed QA both in the existing child-session replay proof and in the new `projectPath` welcome-screen proof.
- Normal chat reload, reconnect hydration, and workflow stop gates are green on the same fixed QA stack.

## Remaining risk

- `stack-manager status --json` can still disagree with the live API provider state; release tooling should continue treating `/api/llm/config` as the authority until that contract is fixed.
