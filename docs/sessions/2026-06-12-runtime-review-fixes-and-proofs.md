# 2026-06-12 Runtime review fixes and proofs

## Scope

- Closed a backend review gap where resumed sessions ignored their persisted runtime kind and branch slot-policy narrowing.
- Sanitized public session runtime updates so chat sessions cannot self-upgrade into broader host-tool runtimes through `PATCH /api/sessions/:id`.
- Synced architecture graph projections with the shared `@kalio/types` contract instead of relying on local casts for `schemaId`, `schemaName`, `toolEvidence`, and `incompleteReason`.
- Fixed frontend turn restoration for persisted architecture/workflow conversations so history rebuilds only defer to a truly live turn, not a stale loop marker.
- Fixed architecture run projection replacement so late async callbacks do not leave duplicate agent-turn bubbles after session reload or child-session navigation.
- Added test-support plumbing and proofs for session-title summarization and agent-budget HITL replay.

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
- Settings/runtime handoff:
  - [`settingsStore.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/settings/settingsStore.ts) now persists the requested settings tab and runtime-model focus signal needed by the existing runtime-settings UI path.
- Full-gate stabilization:
  - [`kv-store.service.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/tool/kv-store.service.spec.ts) and [`security-policy.service.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/hitl/security-policy.service.spec.ts) now keep their in-memory SQLite persona schema aligned with the live Drizzle contract (`max_tool_attempts` plus avatar fields), so repo-wide tests do not fail on stale fixture tables.
  - [`architecture-runtime.service.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/architecture/architecture-runtime.service.spec.ts) now matches the current parent-chat projection contract, which persists the raw user prompt instead of re-prefixing it with schema scaffolding.
  - [`chat-max-iterations.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/__tests__/chat-max-iterations.spec.ts), [`chat.service.event-ordering.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/__tests__/chat.service.event-ordering.spec.ts), and [`issues-verification.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/chat/__tests__/issues-verification.spec.ts) now provide the required `AgentBudgetApprovalService` and `SessionsService` stubs expected by the current `ChatService` constructor.
  - [`ModelSettingsSection.tsx`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/settings/ModelSettingsSection.tsx) no longer clears the monotonic runtime-model focus signal on consumption, which avoids losing focus when `SettingsModal` switches from `llm` to `runtime`.
  - [`executionGraphModel.test.ts`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/chat/graph/executionGraphModel.test.ts) and [`subagent.tool.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/tool/tools/subagent.tool.spec.ts) now assert the current runtime/UI contract rather than a stale pre-refactor behavior.

## Verification

- Backend focused tests:
  - `corepack pnpm --filter kalio-api exec vitest run src/modules/architecture/architecture-graph-projection.spec.ts src/modules/chat/__tests__/chat.service.spec.ts src/modules/chat/sessions.controller.spec.ts src/modules/chat/__tests__/sessions.service.spec.ts`
  - `corepack pnpm --filter kalio-api exec vitest run src/modules/chat/__tests__/chat-test-support.service.spec.ts src/modules/chat/__tests__/chat.gateway.spec.ts src/modules/chat/chat-test-support-agent-budget.controller.spec.ts`
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
- Repo gate / audit / dev smoke:
  - `corepack pnpm test`
  - `corepack pnpm audit:report`
  - `corepack pnpm --filter kalio-web run dev -- --host 127.0.0.1 --port 5188 --strictPort` with a successful `GET http://127.0.0.1:5188` (`HTTP 200`)
- Prior manual/dev proof already held in the earlier slice:
  - [`2026-06-12-dev-loopback-and-review-gap-fixes.md`](/C:/Projekty/kalio-forever/docs/sessions/2026-06-12-dev-loopback-and-review-gap-fixes.md)

## Live-readiness

- Resumed `agent-flow-branch` sessions now keep their narrowed tool surface and branch prompt assembly instead of silently widening back to generic chat behavior.
- Public chat-session metadata no longer acts as an authority for unlocking branch/subagent runtime privileges.
- Workflow/architecture conversations now survive reloads and child-session navigation without duplicate synthetic turns.
- Session-title autogeneration and budget-approval replay now have direct runtime proofs instead of only unit coverage.
- Runtime settings focus survives the `LLM Settings -> Runtime Settings` modal handoff without dropping the model-input focus request.
- The repo-wide automated test gate is green again after refreshing stale test fixtures and constructor harnesses.

## Remaining risks

- [`docs/technical-documentation-kalio.md`](/C:/Projekty/kalio-forever/docs/technical-documentation-kalio.md) still disagrees with the repo on launcher matrix, storage topology, runtime kinds, and self-hosted claims; it needs explicit system-truth answers before it can become the canonical project document.
- [`docs/ux-workstation-page-redesign.md`](/C:/Projekty/kalio-forever/docs/ux-workstation-page-redesign.md) is currently deleted in the worktree but was not part of this verified slice.
- `apps/kalio-web` production build still warns about a large JS chunk (`assets/index-*.js` above 2 MB before gzip). This slice did not introduce that debt, but it remains open.
- Static audit still reports material architecture debt: `docs/audit/2026-06-12-report.md` lists 25 critical oversize files, 2 circular dependencies, and a real silent-error lead in [`EmbeddingsPanel.tsx`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/settings/EmbeddingsPanel.tsx).
