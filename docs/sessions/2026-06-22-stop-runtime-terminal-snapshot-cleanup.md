# 2026-06-22 Stop Runtime Terminal Snapshot Cleanup

## What Changed

- Frontend chat lifecycle now clears stale local `activeAgentLoops` and streaming state when a hydrated session receives a terminal `session:status` snapshot.
- Frontend chat lifecycle now does the same when a terminal `session:runtime_snapshot` arrives without any running child execution, running tool, or queue depth.
- Added a built-QA Playwright regression for workflow stop so the original workflow-specific ghost-running case stays covered.
- Extended `scripts/workflow-release-gate.mjs` so the shared release gate now includes the workflow-stop regression alongside the existing stop and HITL checks.

## Why

The fixed-QA workflow stop bug was not a missing backend stop call. The backend could stop correctly and emit terminal runtime state, but the frontend kept a stale local active-loop projection alive if no separate `agent:done` event arrived. That stale FE loop kept `liveTurnState.stoppable=true`, so the stop button stayed visible and the session looked like it was still running.

## Evidence

- Focused FE regression:
  - `corepack pnpm --filter kalio-web exec vitest run src/features/chat/hooks/useChatSocketEvents.helpers.spec.ts src/features/chat/hooks/useChatSocketEvents.helpers.test.ts src/features/chat/hooks/useChatSocketEvents.queued.test.ts src/features/chat/ChatInterface.test.tsx`
- FE typecheck:
  - `corepack pnpm --filter kalio-web run typecheck`
- Built-QA browser proof on fixed ports:
  - `corepack pnpm --filter @kalio/e2e exec playwright test tests/regression-stop-follow-up.spec.ts --project=chromium`
  - `corepack pnpm --filter @kalio/e2e exec playwright test tests/hitl-tool-confirmation-runtime.spec.ts --project=chromium`
  - `corepack pnpm --filter @kalio/e2e exec playwright test tests/workflow-stop-runtime.spec.ts --project=chromium`
- Consolidated fixed-QA release gate:
  - `corepack pnpm run release:workflow-gate`

## Release Readiness

- Fixed-QA runtime gate: green.
- Workflow stop on built QA: green.
- HITL confirm flow on built QA with forced env mock provider: green.
- Live release: still blocked by previously confirmed provider-quality instability on the rebuilt live baseline (`fs_read` malformed streamed args and one 120000ms branch timeout).

## Remaining Risks

- The fixed-QA gate is now trustworthy for runtime lifecycle and replay behavior, but it is not yet proof that the live provider path is stable enough for release.
- The QA state vs live `/api/llm/config` contract drift remains a separate operational bug; the release tooling already treats the live API response as authoritative.
