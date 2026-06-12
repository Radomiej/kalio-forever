# 2026-06-12 Dev loopback and review gap fixes

## Scope

- Fixed the Windows dev launcher so the Kalio frontend binds to the configured port on all local interfaces instead of `::1` only.
- Closed the AgentFlow launch-context review blocker where inherited `launchAllowedToolNames` survived an orchestrator narrowing without an explicit replacement list.
- Fixed the settings modal handoff so clicking `Edit` on the active provider reliably opens `Runtime Settings` and focuses the runtime model input.

## What changed

- Updated [`start-dev.ps1`](/C:/Projekty/kalio-forever/start-dev.ps1) to launch Vite with `--host 0.0.0.0 --port $FE_PORT --strictPort` and to pass the argument list as a real PowerShell array.
- Updated [`agent-flow-launch-context.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/agent-flow/agent-flow-launch-context.ts) to drop inherited `launchAllowedToolNames` when an orchestrator-restricted explicit context does not own that field.
- Added a regression test in [`agent-flow-launch-context.spec.ts`](/C:/Projekty/kalio-forever/apps/kalio-api/src/modules/agent-flow/agent-flow-launch-context.spec.ts) for the narrowed-scope inheritance case.
- Updated [`SettingsModal.tsx`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/settings/SettingsModal.tsx) to re-issue the runtime-model focus request after the modal actually switches to the `runtime` tab.
- Cleaned [`ModelSettingsSection.tsx`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/settings/ModelSettingsSection.tsx) so the model-fetch callback no longer carries unnecessary hook dependencies.
- Added a modal-level regression test in [`LLMPanel.test.tsx`](/C:/Projekty/kalio-forever/apps/kalio-web/src/features/settings/LLMPanel.test.tsx) that proves the `Edit -> Runtime Settings -> focused model selector` flow.

## Verification

- Dev launcher / live runtime:
  - `.\start-dev.ps1`
  - `Invoke-WebRequest http://localhost:3016/api/health`
  - `Invoke-WebRequest http://localhost:5188`
  - `Invoke-WebRequest http://127.0.0.1:5188`
  - `Get-NetTCPConnection -LocalPort 5188 -State Listen`
  - Playwright browser verification on `http://127.0.0.1:5188/` with cleared telemetry and passed runtime-signal audit
- Backend tests:
  - `npm.cmd exec vitest run src/modules/agent-flow/agent-flow-launch-context.spec.ts src/modules/chat/__tests__/chat-test-support.service.spec.ts src/modules/chat/chat-test-support-agent-budget.controller.spec.ts src/modules/chat/__tests__/chat.service.spec.ts src/modules/chat/__tests__/sessions.service.spec.ts src/modules/architecture/architecture-graph-projection.spec.ts` in `apps/kalio-api`
- Frontend tests:
  - `npm.cmd exec vitest run src/features/settings/LLMPanel.test.tsx src/features/settings/SettingsModal.test.tsx src/features/settings/ModelSettingsSection.test.tsx src/features/settings/ProviderCard.test.tsx src/features/settings/ProviderSettingsSection.test.tsx src/features/settings/registry.test.tsx` in `apps/kalio-web`
- Lint:
  - `npm.cmd exec eslint src/features/settings/ModelSettingsSection.tsx src/features/settings/SettingsModal.tsx` in `apps/kalio-web`
- Typecheck:
  - `npm.cmd run typecheck` in `apps/kalio-web`
  - `npm.cmd run typecheck` in `apps/kalio-api`
- Build:
  - `npm.cmd run build` in `apps/kalio-web`
  - `npm.cmd run build` in `apps/kalio-api`

## Live-readiness

- The manual dev stack is now reachable through both `localhost:5188` and `127.0.0.1:5188`, which removes the prior breakage for external browser reuse and loopback-based QA.
- The reviewed AgentFlow allowance bug is covered by a focused regression test and no longer silently preserves the wider baseline tool list under orchestrator narrowing.
- The runtime-settings focus handoff is now covered by a modal-level regression test rather than only the standalone panel path.

## Remaining risks

- Broader branch work is still in progress outside this fix slice; this note only covers the files and checks listed above.
- `apps/kalio-web` production build still emits a large-chunk warning (`assets/index-*.js` about 1.98 MB before gzip). That is not introduced by this slice, but it remains a performance debt.
- `docs/technical-documentation-kalio.md` currently disagrees with the repo on at least one startup command (`pnpm start:dev` vs current `pnpm dev`), so the document still needs a system-truth pass before it becomes the canonical project reference.
