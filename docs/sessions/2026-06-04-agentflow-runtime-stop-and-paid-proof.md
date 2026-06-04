# AgentFlow Runtime Stop And Paid Proof QA

Date: 2026-06-04

## Goal

Verify the ordinary conversation-started AgentFlow path for the paid Xiaomi provider and fix critical runtime auditability issues found during manual QA.

## What Changed

- Added a `stop` capability to the AgentFlow runtime port.
- Implemented `ArchitectureAgentFlowAdapter.stop()` as an MVP bridge to `ArchitectureRuntimeService.stopRun()`.
- Updated `AgentFlowRuntimeService.stop()` so an AgentFlow stop cascades to the underlying Architecture runtime before storing the local `cancelled` snapshot.
- Added a regression test proving `AgentFlowRuntimeService.stop()` calls the runtime adapter with reconstructed run args.
- Added parent-chat start projection for async Architecture runs so parent conversation history receives the run immediately, before graph execution completes.
- Added normal `chat:stop` cascade to active AgentFlow runs tied to the stopped parent/root/child session.
- Added a `ModuleRef.get(AGENT_FLOW_RUNTIME, { strict: false })` fallback for `chat:stop` so the gateway can resolve the sibling AgentFlow runtime in the real Nest module graph.
- Added AgentFlow `blocked/finalization_missing` projection when Goal Master accepts host build/git evidence but the runtime fallback cannot produce the final artifact.
- Added first-class Architecture stop semantics: `ArchitectureRunStatus` now includes `cancelled`, `ArchitectureRuntimeService.stopRun()` appends `run_stopped`, and AgentFlow trace projection maps it to `flow:stopped` / lifecycle `cancelled`.
- Updated execution graph mapping so direct Architecture runs with status `cancelled` render as terminal error/interruption nodes instead of success.
- Updated `docs/technical-debt.md` with findings from the paid proof run and remaining runtime/product debt.

## QA Evidence

- Paid readiness had previously passed on provider `xiaomimimo` / model `mimo-v2.5`.
- Graph Editor false-start run `M850F2q1JT1LIkJ_0KEeB` completed and appeared in the conversation projection, but it was a developer-path run, not the normal product path.
- Conversation-started Goal Master Delivery Loop run `Ob_SIuSzaMExFOM_95nIu` produced a child Architecture/AgentFlow trace and returned to `waiting_on_orchestrator`.
- Target repo `C:\Projekty\TurboProject2` branch `codex/paid-xiaomi-agentflow-proof` received commit `4d42fad` and `npm.cmd run build` passed.
- Product QA rejected the generated proof page as final evidence because it is mock content, has inconsistent statuses, and regressed existing salon page sections.
- Resume-driven QA sent the blockers back into run `Ob_SIuSzaMExFOM_95nIu`.
- The child workflow produced final commit `737eaf3 fix: restore salon site, replace mock proof with real runtime evidence, fix encoding`.
- Post-commit `npm.cmd run build` passed and `C:\Projekty\TurboProject2` was clean.
- Despite accepted host evidence, AgentFlow still returned to `waiting_on_orchestrator` while `/api/architecture-runs/Ob_SIuSzaMExFOM_95nIu` reported `running`.
- After backend restart, clean normal Talk run `zXYvRz-GOBlv9FMANp-mT` was started from a new ordinary chat session `vNeJeOKVVxdwB-3jIHf5S` with workflow selector `Goal Master Delivery Loop`.
- The clean run reached terminal `failed` quickly because XiaomiMiMo returned `451 Unavailable For Legal Reasons` for cross-border isolation policy.
- Parent conversation persistence was verified via `/api/sessions/vNeJeOKVVxdwB-3jIHf5S/messages`: it contains `architecture:zXYvRz-GOBlv9FMANp-mT:user` and an assistant failure projection with the provider error.
- AgentFlow snapshot for `zXYvRz-GOBlv9FMANp-mT` includes `flowRunId`, `parentSessionId`, `childSessionId`, `openGraphRunId`, terminal `failed` status, and trace events for run creation, orchestrator start, provider error, and failure.
- A second clean normal Talk run `2xdteJG6sw4cVNR0fmDqt` was started from ordinary parent chat session `FA26urjLVVRTnkdVRv02q` with child/root session `arch-2xdteJG6sw4cVNR0fmDqt-root` on target branch `codex/paid-xiaomi-orchestrator-proof-2`.
- Run `2xdteJG6sw4cVNR0fmDqt` also reached terminal `failed` on the first orchestrator node because XiaomiMiMo returned `451 Unavailable For Legal Reasons`.
- Parent conversation persistence was verified via `/api/sessions/FA26urjLVVRTnkdVRv02q/messages`: it contains `architecture:2xdteJG6sw4cVNR0fmDqt:user` and an assistant failure projection with the provider error.
- `C:\Projekty\TurboProject2` remained clean on branch `codex/paid-xiaomi-orchestrator-proof-2`; no generated files or commits were produced by the failed provider-gated run.
- The readiness endpoint initially still produced a false-positive with a short noop-shaped completion smoke after backend restart, so the smoke request was hardened to mimic an ArchitectureRuntime orchestrator request with realistic delegation/research/write tool schemas.
- After hardening and backend restart, live `agentflow:paid-readiness` failed before workflow start on the same XiaomiMiMo `451`, which is the correct fail-closed behavior.
- `agent-orchestrator` persona was hardened to require planning/prototyping, implementation, and refactor/QA phases; persisted research/design notes; branch/commit/build evidence; and parent/child/run ids in final artifacts.
- Live API check after restart verified `agent-orchestrator` contains the three-phase prompt and final artifact requirements, with tools including `run_sub_agentflow`, `spawn_cli_agent`, `web_search`, `vfs_write`, `fs_write`, and `design_preview`.
- A fresh normal Talk run `GDwxvzV-5f-oUY2Mk1iu-` was started from parent chat session `aIjeVybswO09XtQLp3yfF` after persona hardening.
- Run `GDwxvzV-5f-oUY2Mk1iu-` created slot sessions including `arch-GDwxvzV-5f-oUY2Mk1iu--orchestrator` with persona `agent-orchestrator`, but the root session `arch-GDwxvzV-5f-oUY2Mk1iu--root` still showed persona `default`.
- Run `GDwxvzV-5f-oUY2Mk1iu-` failed on the first orchestrator request with XiaomiMiMo `451 Unavailable For Legal Reasons`; no target-repo files changed.
- The parent conversation stored `architecture:GDwxvzV-5f-oUY2Mk1iu-:user` and terminal assistant projection `architecture:GDwxvzV-5f-oUY2Mk1iu-:text:GDwxvzV-5f-oUY2Mk1iu-:event:5`.
- Because full prompt-shaped synthetic completion smoke still passed while the real Architecture run failed, `agentflow:paid-readiness` was extended to inspect recent parent-chat Architecture provider-failure projections.
- Live `agentflow:paid-readiness` now fails closed on recent provider failures from `aIjeVybswO09XtQLp3yfF` / `GDwxvzV-5f-oUY2Mk1iu-` and `FA26urjLVVRTnkdVRv02q` / `2xdteJG6sw4cVNR0fmDqt`.
- Focused stop regression evidence now proves stopped Architecture runs no longer masquerade as `failed`: controller stop returns `cancelled`, the final raw event is `run_stopped`, and AgentFlow projection returns status `cancelled` with `flow:stopped` trace.
- Frontend graph regression evidence now proves cancelled Architecture root projections render as terminal error/interruption nodes rather than success.
- Subagent LLM audit events now record effective runtime provider/model/source plus requested persona model, so manual QA can see whether `agent-orchestrator` actually used the active model or a persona-preferred model.
- Persona model routing now passes a request-scoped override into `LLMService.streamChat()` and creates the provider request with the persona model without mutating the active DB credential model.
- Seeded high-level roles (`orchestrator`, `agent-orchestrator`, `agent-planner`, `agent-reviewer`, `agent-synthesizer`, `agent-release-guard`) now default to `mimo-v2.5-pro`; execution/research/design/QA roles default to `mimo-v2.5`.

## Last Proof Findings

- `agentflow:paid-readiness` only reproduced correctly with an explicit `KALIO_API_BASE_URL`; relying on the implicit local API target was too fragile for proof QA.
- Parent conversation projections can still show a reason string that does not exactly match the terminal runtime reason, so the trace remains the source of truth.
- VFS/tool evidence still drifted from host worktree evidence on the CLI child path, and child reconciliation was not fully settled at the time of the proof.
- The trace was noisy enough that manual review had to filter past unrelated events to find the actual proof signal.
- Persona worker resolution was still not fully closed in the proof path, so the orchestration split remained partially proven.
- Live run `Gq-bpKL4-B5ueq4lwhxed` confirmed both `flow:resume_input` and `flow:return_to_orchestrator`; after resume, implementer started `spawn_cli_agent` + `wait_for`, but the snapshot returned to `waiting_on_orchestrator` with no new project changes in `C:\Projekty\TurboProject2`.
- The same run still showed XiaomiMiMo model `mimo-v2.5-pro` returning MiFE `451` cross-border; the paid path should be validated against `mimo-v2.5`.
- Trace event sequence numbering was duplicated on mixed segments (e.g. repeated `125`), which materially hurts auditability.
- Live run `rH7lbjvi5Sl4EaXWvgT3j` on parent `paid-xiaomi-orchestrator-multiphase-proof-20260604` used effective provider/model `xiaomimimo` / `mimo-v2.5`.
- The run proved the high-level Orchestrator can create a design-debate and route implementation work for a new page, but the Implementer path still overuses `spawn_cli_agent` and timed out before capturing build output.
- Target branch `C:\Projekty\TurboProject2` / `codex/paid-xiaomi-agentflow-orchestrator-proof-4` now contains commit `0f3e3fb feat: add orchestrated launch studio page`.
- Generated artifacts: `docs/orchestrated-launch-studio-design-debate.md`, `src/pages/OrchestratedLaunchStudio.tsx`, and `src/App.tsx` route `/orchestrated-launch-studio`.
- Host verification passed after one small orchestrator QA fix: `npm.cmd run build` produced `tsc -b && vite build`, 36 modules transformed, built in 828ms.
- Text scan passed for the page and design-debate document: no mojibake, no non-ASCII, no fake dates, and demo metrics are labeled.
- Correct visual QA target was Turbo preview `http://127.0.0.1:5199/orchestrated-launch-studio`; `http://localhost:5188/` is the Kalio shell and is not the generated Turbo route.
- Playwright full-page quality audit after the fix reported `0` high WCAG findings and no runtime findings; remaining medium findings are existing Belle navbar target/focus-size issues.
- AgentFlow still ended `blocked` with `flow:missing_final_artifact` after resume, because the Orchestrator read host evidence and routed back to Implementer instead of accepting evidence into a terminal final artifact.
- No AgentFlow event showed an actual `web_search` tool call for the design-debate; the document persisted general source names, not concrete source URLs.
- Fixed the runtime recovery gap found by run `rH7lbjvi5Sl4EaXWvgT3j`: `flow:missing_final_artifact` and `flow:finalization_missing` blocked snapshots are now resumable, matching `flow:final_artifact_blocker`.
- Fixed resume routing for the host-evidence recovery case: when external QA is passed and the latest cursor points at a later non-judge node, ArchitectureRuntime re-enters the last completed judge node instead of replaying the pending Implementer.
- Live resume proof on run `rH7lbjvi5Sl4EaXWvgT3j` confirmed the patched recovery path without manual target-repo edits.
- Resume request carried external host evidence (`host-build-and-playwright`, `status=passed`, `highFindings=0`) and effective provider/model stayed `xiaomimimo` / `mimo-v2.5`.
- The trace now shows the desired lifecycle for this run: previous `flow:missing_final_artifact`, then `flow:resume_input`, `Goal Master started`, `Goal Master completed`, `Verified Completion Artifact started`, `flow:final_artifact`, and final status `done`.
- The final artifact accepted branch `codex/paid-xiaomi-agentflow-orchestrator-proof-4`, commit `0f3e3fb feat: add orchestrated launch studio page`, changed files, build result, visual QA result, and text QA result.
- Audit log for `arch-rH7lbjvi5Sl4EaXWvgT3j-goal_master` records provider/model fields: `provider=xiaomimimo`, `model=mimo-v2.5`, `modelSource=request`, `personaModel=mimo-v2.5-pro`, `requestModel=mimo-v2.5`.
- Event sequence numbering is still not clean after resumed mixed segments: tail evidence includes repeated sequence values around `243` and `247`, so chronology is readable but not yet audit-grade.
- Added AgentFlowRuntime merge normalization so refreshed/resumed AgentFlow snapshots expose strictly increasing local trace sequences even when underlying architecture events restarted from an older sequence number.
- Added Agent Orchestrator seed/refresh guidance for research-source auditability: persisted design/research notes must include concrete `web_search` URLs, or explicitly say `seeded/no live search` when live search was unavailable or unused.

## Verification

- `npm.cmd run test -- apps/kalio-api/src/modules/agent-flow/agent-flow-runtime.service.spec.ts apps/kalio-api/src/modules/agent-flow/architecture-agent-flow.adapter.spec.ts apps/kalio-api/src/modules/agent-flow/agent-flow-runs.controller.spec.ts`
  - Passed. The test gate ran broader workspace coverage: backend `164` files / `1958` tests and web `110` files / `932` tests.
- `npm.cmd run test -- apps/kalio-api/src/modules/architecture/architecture-runtime.service.spec.ts apps/kalio-api/src/modules/chat/__tests__/chat.gateway.spec.ts apps/kalio-api/src/modules/agent-flow/architecture-agent-flow.adapter.spec.ts apps/kalio-api/src/modules/agent-flow/agent-flow-runtime.service.spec.ts`
  - Passed. The test gate ran broader workspace coverage: backend `164` files / `1962` tests and web `110` files / `932` tests.
- `npm.cmd run typecheck`
  - Passed for `@kalio/types`, `@kalio/sdk`, `kalio-api`, and `kalio-web`.
- `npm.cmd run test -- apps/kalio-api/src/modules/chat/__tests__/chat.gateway.spec.ts`
  - Passed. The test gate ran broader workspace coverage: backend `164` files / `1962` tests and web `110` files / `932` tests.
- `node scripts\agentflow-paid-readiness.test.mjs`
  - Passed `7` tests, including the regression where model listing passes but real completion smoke fails.
- `npm.cmd run test -- apps/kalio-api/src/modules/credentials/credentials.controller.spec.ts`
  - Passed after hardening the runtime-shaped completion smoke. The test gate ran broader workspace coverage: backend `164` files / `1966` tests and web `110` files / `933` tests.
- `npm.cmd run test -- apps/kalio-api/src/modules/architecture/architecture.controller.spec.ts apps/kalio-api/src/modules/agent-flow/architecture-agent-flow.adapter.spec.ts apps/kalio-api/src/modules/agent-flow/agent-flow-runtime.service.spec.ts packages/@kalio/types/src/__tests__/contracts.test.ts`
  - Passed. The test gate ran broader workspace coverage: backend `164` files / `1965` tests and web `110` files / `932` tests.
- `npm.cmd run test -- apps/kalio-web/src/features/chat/graph/executionGraphArchitectureRoot.test.ts`
  - Passed. The test gate ran broader workspace coverage: backend `164` files / `1965` tests and web `110` files / `933` tests.
- `$env:KALIO_API_BASE_URL='http://localhost:3016/api'; npm.cmd run agentflow:paid-readiness`
  - Failed as expected on one blocker: active credential completion smoke returned XiaomiMiMo `451 Unavailable For Legal Reasons` cross-border isolation policy.
- `npm.cmd run typecheck`
  - Passed again after hardening `CredentialsController.testCompletionById()`.
- `node scripts\agentflow-paid-readiness.test.mjs`
  - Passed `8` tests after adding the recent provider-failure projection regression.
- `npm.cmd run test -- apps/kalio-api/src/modules/credentials/credentials.controller.spec.ts apps/kalio-api/src/modules/persona/persona.service.spec.ts`
  - Passed after persona and readiness-gate hardening. The test gate ran broader workspace coverage: backend `164` files / `1966` tests and web `110` files / `933` tests.
- `npm.cmd run typecheck`
  - Passed after persona and readiness-gate hardening.
- `npm.cmd run test -- apps/kalio-api/src/modules/chat/__tests__/subagent-runtime.service.spec.ts`
  - Passed after adding provider/model/source/personaModel audit fields to subagent LLM request and response events. The test gate ran broader workspace coverage: backend `164` files / `1966` tests and web `110` files / `933` tests.
- `npm.cmd run typecheck`
  - Passed after adding subagent LLM model audit fields.
- `npm.cmd run test -- apps/kalio-api/src/modules/chat/__tests__/llm-service.adapter.spec.ts apps/kalio-api/src/modules/llm/llm.service.spec.ts apps/kalio-api/src/modules/chat/__tests__/subagent-runtime.service.spec.ts`
  - Broad gate failed on unrelated `wait-for.tool.spec.ts` polling expectation (`expected 2 calls, got 1`). The changed specs passed in the same run.
- `corepack pnpm --filter kalio-api exec vitest run src/modules/chat/__tests__/llm-service.adapter.spec.ts src/modules/llm/llm.service.spec.ts src/modules/chat/__tests__/subagent-runtime.service.spec.ts`
  - Passed after adding request-scoped model override: `3` files / `46` tests.
- `corepack pnpm --filter kalio-api exec vitest run src/modules/tool/tools/wait-for.tool.spec.ts`
  - Passed on rerun: `1` file / `7` tests, confirming the broad-gate failure was not caused by the model-routing change.
- `corepack pnpm --filter kalio-api exec vitest run src/modules/chat/__tests__/llm-service.adapter.spec.ts src/modules/llm/llm.service.spec.ts src/modules/chat/__tests__/subagent-runtime.service.spec.ts src/modules/persona/persona.service.spec.ts`
  - Passed after seeded persona model backfill: `4` files / `84` tests.
- `npm.cmd run typecheck`
  - Passed after request-scoped persona model routing and seeded model backfill.
- `corepack pnpm --filter kalio-api exec vitest run src/modules/architecture/architecture-runtime.service.spec.ts`
  - Passed after host-evidence resume finalization recovery: `1` file / `80` tests.
- `corepack pnpm --filter kalio-api exec vitest run src/modules/agent-flow/agent-flow-runtime.service.spec.ts`
  - Passed after missing-final-artifact resume recovery: `1` file / `42` tests.
- `corepack pnpm --filter kalio-api run typecheck`
  - Passed after the AgentFlow/ArchitectureRuntime resume recovery changes.
- `corepack pnpm --filter kalio-api exec vitest run src/modules/agent-flow/agent-flow-runtime.service.spec.ts`
  - Passed after trace sequence normalization: `1` file / `43` tests.
- `corepack pnpm --filter kalio-api exec vitest run src/modules/persona/persona.service.spec.ts`
  - Passed after Agent Orchestrator research-source seed hardening: `1` file / `40` tests.
- `corepack pnpm --filter kalio-api run typecheck`
  - Passed after trace sequence normalization and persona seed hardening.
- `POST http://127.0.0.1:3016/api/agent-flows/runs/rH7lbjvi5Sl4EaXWvgT3j/resume`
  - Passed as a live paid Xiaomi ordinary-model proof after the recovery fix. Result: `status=done`, `events=263`, last event `flow:node_result` / `Verified Completion Artifact completed.`
- `GET http://127.0.0.1:3016/api/agent-flows/runs/rH7lbjvi5Sl4EaXWvgT3j/events`
  - Confirmed lifecycle tail includes `flow:resume_input`, `goal-master`, `flow:final_artifact`, and terminal finalizer completion.
- `GET http://127.0.0.1:3016/api/audit-log?limit=80&sessionId=arch-rH7lbjvi5Sl4EaXWvgT3j-goal_master`
  - Confirmed effective provider/model audit fields on live LLM requests and responses.
- `$env:KALIO_API_BASE_URL='http://localhost:3016/api'; npm.cmd run agentflow:paid-readiness`
  - Failed as expected after the recent provider-failure projection check: fresh Talk-started Architecture runs `GDwxvzV-5f-oUY2Mk1iu-` and `2xdteJG6sw4cVNR0fmDqt` contain XiaomiMiMo `451` provider failures.
- `C:\Projekty\TurboProject2`: `git status --short`
  - Empty on branch `codex/paid-xiaomi-orchestrator-proof-2` after failed run `2xdteJG6sw4cVNR0fmDqt`.
  - Empty again after failed run `GDwxvzV-5f-oUY2Mk1iu-`.
- `git -C C:\Projekty\kalio-forever diff --check`
  - Passed with CRLF normalization warnings only.
- `C:\Projekty\TurboProject2`: `npm.cmd run build`
  - Passed after final commit `737eaf3`.
- `C:\Projekty\TurboProject2`: `npm.cmd run build`
  - Passed on branch `codex/paid-xiaomi-agentflow-orchestrator-proof-4` after commit `0f3e3fb`: `tsc -b && vite build`, 36 modules transformed.
- Playwright quality audit for Turbo preview:
  - `http://127.0.0.1:5199/orchestrated-launch-studio` after QA fix returned status `warning`, WCAG high `0`, runtime high `0`.
  - Snapshot: `C:\Projekty\mcp-playwrigh-master\.local-data\mcp-playwright-orchestrator\snapshots\1554c697-204e-410c-a2b7-52dd32de2de2--58dc9db3-b0fb-489a-ad69-1f721f0baf08--turbo-orchestrated-launch-studio-after-fix--\2026-06-04T20-59-37-208Z-594ef69b-0718-4605-b7dd-356db2b45305.png`
- Playwright trace artifact:
  - `C:\Projekty\mcp-playwrigh-master\.local-data\mcp-playwright-orchestrator\artifacts\224fe816-c44e-4cda-bb83-b0e27d7475b6\paid-xiaomi-ordinary-workflow-1780566788073-4c3db90e-c352-4a93-b31e-f5f54c0f7525.zip`
- Playwright trace artifact for clean Talk proof:
  - `C:\Projekty\mcp-playwrigh-master\.local-data\mcp-playwright-orchestrator\artifacts\5e95f793-1a56-49b0-a06e-4d19c0efcc4f\normal-chat-agentflow-proof-1780569571248-222aa6cf-e7b1-496c-b4d8-ac6013502a8d.zip`
- Playwright trace artifact for second normal Talk proof:
  - `C:\Projekty\mcp-playwrigh-master\.local-data\mcp-playwright-orchestrator\artifacts\5e95f793-1a56-49b0-a06e-4d19c0efcc4f\paid-xiaomi-orchestrator-proof-2026-06-04-1780571856165-436c8c28-67a5-4423-8a8b-ea255062d750.zip`
- Playwright trace artifact for persona-hardened normal Talk proof:
  - `C:\Projekty\mcp-playwrigh-master\.local-data\mcp-playwright-orchestrator\artifacts\5e95f793-1a56-49b0-a06e-4d19c0efcc4f\paid-xiaomi-orchestrator-persona-proof-2026-06-04-1780572954649-2e15f19a-60b5-4f39-9a76-493a29e6a3e0.zip`
- Playwright evidence bundle for clean Talk proof:
  - Snapshot: `C:\Projekty\mcp-playwrigh-master\.local-data\mcp-playwright-orchestrator\snapshots\5e95f793-1a56-49b0-a06e-4d19c0efcc4f--6dc8536f-0e98-4940-bf00-cc602f03ae1c--normal-chat-agentflow-provider-failure-proof\2026-06-04T10-39-41-396Z-aadfc9b3-3cb4-4b9b-af92-8ff6a480dbb7.png`
  - Finding: canvas/inspector content can sit outside the 1440px viewport; tracked in `docs/technical-debt.md`.

## Live Readiness

Partially ready.

The ordinary-model paid path has a live terminal proof: run `rH7lbjvi5Sl4EaXWvgT3j` now ends `done` after external host evidence is resumed through Goal Master and final artifact. Paid readiness can now smoke-test `mimo-v2.5-pro` separately from the active worker model, and the live model-specific smoke passed. The full original objective remains incomplete because design-debate research persistence did not prove concrete `web_search` URL capture.

## Remaining Blockers

- Live manual stop still needs browser/API evidence on a long-running run after the provider gate is resolved or a controlled mock long-running run is used.
- AgentFlow verifier did not reconcile the host repo commit/build evidence with its isolated VFS/tool evidence.
- UI inspector still needs stronger "Open child graph" behavior; current evidence indicates it mostly switches session and may not focus `graphRunId`.
- Paid Xiaomi readiness now has a real chat-completion smoke request and can additionally require a model-specific high-level smoke via `AGENTFLOW_REQUIRED_HIGH_LEVEL_MODEL`.
- A clean normal-chat paid proof using `mimo-v2.5-pro` for actual high-level graph nodes is still needed; ordinary `mimo-v2.5` now has terminal `done` proof on run `rH7lbjvi5Sl4EaXWvgT3j`.
- Resume path remains non-terminal in `Gq-bpKL4-B5ueq4lwhxed` when child CLI enters `spawn_cli_agent` / `wait_for` path without host worktree diff, and trace sequence de-duplication still needs correction.
- Event sequence de-duplication is now covered at the AgentFlow merge layer, but it still needs live recheck on a fresh resumed run after backend reload.
- A fresh flow is still needed to prove the new research-source contract creates either concrete `web_search` URLs or a clear `seeded/no live search` label in the persisted design-debate document.

## Update: Research-Source Contract Proof And CLI Guard Fix

- Fresh ordinary-model run `0SsbHDnwO_7ZuwzYZjNHn` created `C:\Projekty\TurboProject2\docs\orchestrated-launch-studio-research-source-audit.md` on branch `codex/paid-xiaomi-agentflow-orchestrator-proof-4`.
- Effective LLM audit for the run showed `provider=xiaomimimo`, `model=mimo-v2.5`, `modelSource=request`; this confirms the ordinary model path uses the Xiaomi provider rather than a bypass.
- The implementer runtime did not expose `web_search`, so the persisted audit note honestly records `seeded/no live search`, `web_search Used: No`, and `Source URLs: None`.
- Host verification confirmed the audit note is ASCII-only, has `Audit Date: 2026-06-04`, contains no `2025`, and contains the required `seeded/no live search` marker.
- Resume with `externalQualityGate.status=passed` produced an accepted `flow:final_artifact`, but the live process still projected the snapshot as `blocked` because unresolved CLI child evidence was evaluated after the host QA gate.
- Patched `ArchitectureAgentFlowAdapter` so an explicit passed external quality gate is treated as independent host verification for unresolved CLI child evidence. This preserves the original guard for weak/no-evidence finalization while avoiding a false `blocked` after host-verified acceptance.
- Patched AgentFlow snapshot merge to drop stale synthetic `flow:unresolved_cli_children` events when refreshed runtime projection no longer contains that blocker.
- Live recheck for run `0SsbHDnwO_7ZuwzYZjNHn` now reports `status=done`, event count `181`, last event `flow:node_result`, and `hasUnresolved=0` from `/api/agent-flows/runs/:id/events`.
- Static routing audit by two subagents found no evidence that `mimo-v2.5-pro` requests bypass the shared text provider. Model override changes only the model field on the selected provider config; the `451` remains a Xiaomi/provider-side cross-border policy/access blocker.
- Live search check showed `/api/search/config` has `configured=false` and `/api/search/test` fails with `Web search not configured`, so actual persisted online source URLs are blocked by missing search credentials. Unit tests still prove `web_search` with `offline_search=false` calls external search and persists through memory ingestion.
- Added Web Search config/smoke checks to `agentflow:paid-readiness`, so the pre-paid gate fails before starting another research/source-persistence flow when Web Search is not configured.

## Verification Update

- `corepack pnpm --filter kalio-api exec vitest run src/modules/agent-flow/architecture-agent-flow.adapter.spec.ts`
  - Passed: `1` file / `36` tests.
- `corepack pnpm --filter kalio-api exec vitest run src/modules/agent-flow/agent-flow-runtime.service.spec.ts`
  - Passed: `1` file / `43` tests.
- `corepack pnpm --filter kalio-api run typecheck`
  - Passed.
- `corepack pnpm --filter kalio-api exec vitest run src/modules/tool/tools/web-search.tool.spec.ts src/modules/chat/__tests__/tool-dispatch.service.spec.ts`
  - Passed: `2` files / `39` tests.
- `node scripts\agentflow-paid-readiness.test.mjs`
  - Passed: `14` tests, including the new Web Search not-configured blocker.
- `$env:KALIO_API_BASE_URL='http://127.0.0.1:3016/api'; npm.cmd run agentflow:paid-readiness`
  - Failed as expected with `2` blockers: Web Search is not configured and Web Search smoke failed.
- `$env:KALIO_API_BASE_URL='http://127.0.0.1:3016/api'; $env:AGENTFLOW_REQUIRED_HIGH_LEVEL_MODEL='mimo-v2.5-pro'; npm.cmd run agentflow:paid-readiness`
  - High-level model smoke passed for `xiaomimimo / mimo-v2.5-pro`; command still failed on the same `2` Web Search blockers.
- `GET http://127.0.0.1:3016/api/agent-flows/runs/0SsbHDnwO_7ZuwzYZjNHn/events`
  - Passed live audit check: no stale `flow:unresolved_cli_children` events remain after the terminal `done` projection.

## Remaining Blockers After This Slice

- `mimo-v2.5-pro` passes the model-specific readiness smoke, but full multi-node high-level AgentFlow execution on pro is not yet re-proven.
- The research-source contract is only proven for the honest fallback (`seeded/no live search`), not for actual persisted live `web_search` URLs because the local Web Search provider is not configured.

## Goal Completion Audit Snapshot

- Kalio FE `http://localhost:5188/` is reachable and returns `200` with title `Kalio`.
- Active LLM config is `provider=xiaomimimo`, `model=mimo-v2.5`, `source=db`.
- TurboProject2 branch `codex/paid-xiaomi-agentflow-orchestrator-proof-4` is clean and includes commits `0f3e3fb` (page) and `9416e32` (research-source audit note).
- Turbo preview `http://127.0.0.1:5199/orchestrated-launch-studio` is reachable and returns `200`.
- AgentFlow run `0SsbHDnwO_7ZuwzYZjNHn` is terminal `done`; event audit has `count=181`, `hasFinal=1`, `hasResume=2`, and `hasUnresolved=0`.
- Research audit note exists, is ASCII-only, contains `seeded/no live search`, contains `2026-06-04`, contains no `2025`, and contains `0` live URLs.
- Search config remains `provider=perplexity`, `configured=false`, so live `web_search` URL persistence is not currently provable.
- `AGENTFLOW_REQUIRED_HIGH_LEVEL_MODEL=mimo-v2.5-pro` readiness smoke passed on the live API.
- The original objective is therefore still not complete: it requires live web-search persistence and a fresh full high-level AgentFlow proof using `mimo-v2.5-pro` in graph execution, while the current hard blocker is missing Web Search configuration.
