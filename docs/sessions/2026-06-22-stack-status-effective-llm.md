# 2026-06-22 Stack Status Effective LLM

## What Changed

- Extracted managed-stack status helpers into `scripts/stack-status.mjs`.
- `node scripts/stack-manager.mjs status --json` now returns `effectiveLlm` from the running backend `/api/llm/config`, while preserving the original startup snapshot in `state`.
- `scripts/run-ac13-qa-stack.mjs` now logs the effective provider instead of the stale startup snapshot.

## Why

- Fixed QA and release operators were seeing stale provider/model values after live credential re-activation because the stack state file only captured startup env.
- This was the last known manual-QA blocker for the release-prep slice because it made the operator-facing stack status untrustworthy even when the real API config was correct.

## Verification

- `node --test scripts/stack-state.test.mjs scripts/stack-status.test.mjs scripts/runtime-scripts.test.mjs`
- `node scripts/stack-manager.mjs status --json`
- `Invoke-WebRequest http://127.0.0.1:3316/api/llm/config`
- `node scripts/agentflow-paid-readiness.mjs --api http://127.0.0.1:3316/api`
- `npm.cmd run release:workflow-gate`

## Live Readiness

- Fixed QA on `3316/5288` is green after the change.
- `status --json.effectiveLlm` matches the live API config: `openrouter / cohere/north-mini-code:free / db`.
- No remaining blocker is known in the managed-stack status contract.

## Remaining Risks

- This does not improve live-model output quality itself; it fixes operator truth and release gating around provider/model/source visibility.
