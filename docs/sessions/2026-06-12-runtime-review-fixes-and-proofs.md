# 2026-06-12 Runtime review fixes and proofs

## Scope

- Closed a backend review gap where resumed sessions ignored their persisted runtime kind and branch slot-policy narrowing.
- Sanitized public session runtime updates so chat sessions cannot self-upgrade into broader host-tool runtimes through `PATCH /api/sessions/:id`.
- Synced architecture graph projections with the shared `@kalio/types` contract instead of relying on local casts for `schemaId`, `schemaName`, `toolEvidence`, and `incompleteReason`.
- Fixed frontend turn restoration for persisted architecture/workflow conversations so history rebuilds only defer to a truly live turn, not a stale loop marker.
- Fixed architecture run projection replacement so late async callbacks do not leave duplicate agent-turn bubbles after session reload or child-session navigation.
- Added test-support plumbing and proofs for session-title summarization and agent-budget HITL replay.
- Closed the remaining CI review regressions in the current branch: a stale frontend settings import that broke `kalio-web` typecheck/build, plus a clean-build mismatch where `@kalio/sdk` package metadata pointed at `dist/index.js` even though a fresh build only emitted `dist/sdk/src/index.js`.
- Fixed session-deletion lifecycle so deleting a chat while a turn is still streaming drains the session pipeline before the DB row is removed, instead of racing message persistence against the `sessions` foreign key.

## What changed

- Backend runtime assembly:
  - [`context-assembly.service.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/context-assembly.service.ts) now exposes session-aware assembly and preserves branch slot-policy/model overrides.
  - [`context-preview.service.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/context-preview.service.ts) now uses the shared session-runtime assembly path.
  - [`chat.service.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/chat.service.ts) now loads the persisted session runtime context before building the effective prompt/tool policy.
  - [`sessions.controller.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/sessions.controller.ts) now sanitizes public `runtimeContext` down to safe chat-only data.
- Shared/runtime contract:
  - [`packages/@kalio/types/src/index.ts`](/C:/Projekty/kalio-forever/packages/@kalio/types/src/index.ts) now carries `schemaId` / `schemaName` on `ArchitectureGraphProjection` and exposes node `toolEvidence` / `incompleteReason`.
  - [`architecture-graph-projection.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/architecture/architecture-graph-projection.ts) now returns a correctly typed shared projection without cast-only metadata.
  - [`architectureChatSummary.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/architectureChatSummary.ts) and [`executionGraphArchitectureRoot.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/graph/executionGraphArchitectureRoot.ts) now consume the shared projection contract directly.
- Frontend history / projection recovery:
  - [`architectureTurnProjection.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/architectureTurnProjection.ts) deduplicates by both prompt message id and architecture run id.
  - [`useChatComposerActions.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/hooks/useChatComposerActions.ts) and [`useExecutionGraphLaunch.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/graph/useExecutionGraphLaunch.ts) now replace pending architecture turns through that shared helper.
  - [`useChatSessionActivation.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/hooks/useChatSessionActivation.ts) and [`SessionPanel.tsx`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/sessions/SessionPanel.tsx) now rebuild turns whenever the session lacks a real active turn id, even if a stale loop entry remains.
- Title / budget replay support:
  - [`sessions.service.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/sessions.service.ts) now asks the LLM for concise session-title summaries and falls back deterministically when the provider is unavailable or echoes the prompt.
  - [`agent-budget-approval.service.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/agent-budget-approval.service.ts), [`session-pipeline.service.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/session-pipeline.service.ts), [`chat.gateway.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/chat.gateway.ts), and [`chat-test-support.service.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/chat-test-support.service.ts) now support synthetic pending-budget replay for verification and recovery proofs.
  - [`chat-test-support-agent-budget.controller.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/chat-test-support-agent-budget.controller.ts) exposes the budget replay test hooks in test mode.
- Session delete lifecycle:
  - [`session-pipeline.service.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/session-pipeline.service.ts) now reserves a real per-turn completion promise at slot-claim time and exposes `stopAndDrain(sessionId)` so destructive lifecycle actions can abort the active turn, drop queued work, and wait for the turn to settle.
  - [`sessions.controller.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/sessions.controller.ts) now drains the active session pipeline before deleting the backing session row.
  - [`session-pipeline.service.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/__tests__/session-pipeline.service.spec.ts) and [`sessions.controller.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/sessions.controller.spec.ts) now prove the drain-before-delete ordering and seeded-turn edge case.
- Settings/runtime handoff:
  - [`settingsStore.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/settings/settingsStore.ts) now persists the requested settings tab and runtime-model focus signal needed by the existing runtime-settings UI path.
- Full-gate stabilization:
  - [`kv-store.service.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/tool/kv-store.service.spec.ts) and [`security-policy.service.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/hitl/security-policy.service.spec.ts) now keep their in-memory SQLite persona schema aligned with the live Drizzle contract (`max_tool_attempts` plus avatar fields), so repo-wide tests do not fail on stale fixture tables.
  - [`architecture-runtime.service.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/architecture/architecture-runtime.service.spec.ts) now matches the current parent-chat projection contract, which persists the raw user prompt instead of re-prefixing it with schema scaffolding.
  - [`chat-max-iterations.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/__tests__/chat-max-iterations.spec.ts), [`chat.service.event-ordering.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/__tests__/chat.service.event-ordering.spec.ts), and [`issues-verification.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/__tests__/issues-verification.spec.ts) now provide the required `AgentBudgetApprovalService` and `SessionsService` stubs expected by the current `ChatService` constructor.
  - [`ModelSettingsSection.tsx`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/settings/ModelSettingsSection.tsx) no longer clears the monotonic runtime-model focus signal on consumption, which avoids losing focus when `SettingsModal` switches from `llm` to `runtime`.
  - [`executionGraphModel.test.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/graph/executionGraphModel.test.ts) and [`subagent.tool.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/tool/tools/subagent.tool.spec.ts) now assert the current runtime/UI contract rather than a stale pre-refactor behavior.
- Audit follow-up:
  - [`EmbeddingsPanel.tsx`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/settings/EmbeddingsPanel.tsx) now logs install-polling availability failures instead of swallowing them silently while still preserving the visible `installing` state.
  - [`EmbeddingsPanel.test.tsx`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/settings/EmbeddingsPanel.test.tsx) now proves that a failed install poll reports the error and keeps the progress UI intact.
- CI gate follow-up:
  - [`ModelSettingsSection.tsx`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/settings/ModelSettingsSection.tsx) no longer carries an unused `useSettingsStore` import, which restores the frontend typecheck/build path used by both the `frontend` and `e2e` CI jobs.
  - [`packages/@kalio/sdk/tsconfig.json`](/C:/Projekty/kalio-forever/packages/@kalio/sdk/tsconfig.json) now builds from `rootDir=src` without pulling `@kalio/types/src` into the emitted tree, so a clean workspace build produces the package entrypoints declared in `package.json`.
  - [`monorepo-package-compatibility.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/monorepo-package-compatibility.spec.ts) now asserts that the `main` and `types` files declared by `@kalio/types` and `@kalio/sdk` actually exist after build, so stale local `dist/` output can no longer hide a broken package contract.

## Verification

- Backend focused tests:
  - `corepack pnpm --filter kalio-api exec vitest run src/modules/architecture/architecture-graph-projection.spec.ts src/modules/chat/__tests__/chat.service.spec.ts src/modules/chat/sessions.controller.spec.ts src/modules/chat/__tests__/sessions.service.spec.ts`
  - `corepack pnpm --filter kalio-api exec vitest run src/modules/chat/__tests__/chat-test-support.service.spec.ts src/modules/chat/__tests__/chat.gateway.spec.ts src/modules/chat/chat-test-support-agent-budget.controller.spec.ts`
  - `corepack pnpm --filter kalio-api exec vitest run src/modules/chat/sessions.controller.spec.ts src/modules/chat/__tests__/session-pipeline.service.spec.ts`
- Frontend focused tests:
  - `corepack pnpm --filter kalio-web exec vitest run src/features/chat/architectureTurnProjection.test.ts src/features/chat/ChatInterface.test.tsx src/features/sessions/SessionPanel.test.tsx src/features/chat/architectureChatSummary.test.ts src/features/chat/graph/executionGraphArchitectureRoot.test.ts`
  - `corepack pnpm --filter kalio-web exec vitest run src/features/settings/LLMPanel.test.tsx src/features/settings/SettingsModal.test.tsx`
- Typecheck / build:
  - `corepack pnpm --filter @kalio/types run build`
  - `corepack pnpm --filter kalio-api run typecheck`
  - `corepack pnpm --filter kalio-api run build`
  - `corepack pnpm --filter kalio-web run typecheck`
  - `corepack pnpm --filter kalio-web run build`
- E2E proofs:
  - `npm.cmd run test:e2e -- apps/e2e/tests/ac-21-session-title.spec.ts apps/e2e/tests/architecture-chat-subagent-turn.spec.ts apps/e2e/tests/mock-tool-intent-fallback.spec.ts apps/e2e/tests/proof-workflow-architecture-label.spec.ts apps/e2e/tests/regression-agent-budget-hitl.spec.ts`
  - `corepack pnpm --filter @kalio/e2e test:e2e -- --project=chromium tests/ac-13-anti-spam.spec.ts` with a clean backend log scan for `FOREIGN KEY constraint failed` / `Session .* not found`
- Repo gate / audit / dev smoke:
  - `corepack pnpm test`
  - `corepack pnpm audit:report`
  - `corepack pnpm --filter kalio-web run dev -- --host 127.0.0.1 --port 5188 --strictPort` with a successful `GET http://127.0.0.1:5188` (`HTTP 200`)
- Post-audit follow-up:
  - `corepack pnpm --filter kalio-web exec vitest run src/features/settings/EmbeddingsPanel.test.tsx`
  - `corepack pnpm test`
  - `corepack pnpm audit:report` (remaining highs reduced from `3` to `2`)
- Post-CI-fix follow-up:
  - `corepack pnpm --filter @kalio/types run build`
  - `corepack pnpm --filter @kalio/sdk run clean`
  - `corepack pnpm --filter @kalio/sdk run build`
  - `corepack pnpm --filter kalio-api exec node -e "console.log(require.resolve('@kalio/sdk')); console.log(Boolean(require('@kalio/sdk').KalioSDK));"`
  - `corepack pnpm --filter kalio-api exec vitest run src/modules/monorepo-package-compatibility.spec.ts`
  - `corepack pnpm --filter kalio-api run typecheck`
  - `corepack pnpm --filter kalio-api test:cov`
  - `corepack pnpm --filter kalio-web run typecheck`
  - `corepack pnpm --filter kalio-web run build`
  - `corepack pnpm --filter kalio-web test:cov`
  - `corepack pnpm test`
  - `corepack pnpm audit:report`
- Prior manual/dev proof already held in the earlier slice:
  - [`2026-06-12-dev-loopback-and-review-gap-fixes.md`](/C:/Projekty/kalio-forever/docs/sessions/2026-06-12-dev-loopback-and-review-gap-fixes.md)

## Live-readiness

- Resumed `agent-flow-branch` sessions now keep their narrowed tool surface and branch prompt assembly instead of silently widening back to generic chat behavior.
- Public chat-session metadata no longer acts as an authority for unlocking branch/subagent runtime privileges.
- Workflow/architecture conversations now survive reloads and child-session navigation without duplicate synthetic turns.
- Session-title autogeneration and budget-approval replay now have direct runtime proofs instead of only unit coverage.
- Session deletion no longer removes the database row underneath an in-flight turn, so E2E cleanup does not leave spurious foreign-key or `SESSION_NOT_FOUND` noise in the backend log.
- Runtime settings focus survives the `LLM Settings -> Runtime Settings` modal handoff without dropping the model-input focus request.
- The repo-wide automated test gate is green again after refreshing stale test fixtures and constructor harnesses.
- The last direct silent-error finding from the audit is closed; remaining high-severity audit items are structural cycles rather than swallowed runtime failures.
- Clean `@kalio/sdk` builds now match the published workspace package contract instead of relying on stale local `dist/` files that CI never had.

## Remaining risks

- [`docs/technical-documentation-kalio.md`](/C:/Projekty/kalio-forever/docs/technical-documentation-kalio.md) still disagrees with the repo on launcher matrix, storage topology, runtime kinds, and self-hosted claims; it needs explicit system-truth answers before it can become the canonical project document.
- [`docs/ux-workstation-page-redesign.md`](/C:/Projekty/kalio-forever/docs/ux-workstation-page-redesign.md) is currently deleted in the worktree but was not part of this verified slice.
- `apps/kalio-web` production build still warns about a large JS chunk (`assets/index-*.js` above 2 MB before gzip). This slice did not introduce that debt, but it remains open.
- Static audit still reports material architecture debt: `docs/audit/2026-06-12-report.md` lists 25 critical oversize files and 2 circular dependencies. The direct silent-error lead in [`EmbeddingsPanel.tsx`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/settings/EmbeddingsPanel.tsx) is now closed.
