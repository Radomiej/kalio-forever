# 2026-05-17 22:23 — HITL settings modes

## What was done

- Added a new backend HITL module with persisted global config at `/api/hitl/config`.
- Introduced three approval modes: `manual` (default), `auto`, and `bypass`.
- Wired `ToolDispatchService` to consult the central HITL policy before opening manual confirmation.
- Added persona-based auto decision evaluation using `PersonaService`, `SkillsService`, and `LLMService`, with strict JSON `{ agree, reason }` parsing and fallback to manual on failures.
- Extended RA-App approval handling so batches can auto-execute when fully approved, while rejected or unresolved batches fall back to the existing manual overlay flow.
- Updated `run_raapp` and `raapp_execute_dsl` to use the new RA-App batch resolver and return `nativeResults` when approvals are resolved server-side.
- Added a new frontend Settings panel for HITL approvals with mode selection and persona picker.

## Files touched

- `apps/kalio-api/src/modules/hitl/hitl.module.ts`
- `apps/kalio-api/src/modules/hitl/hitl.types.ts`
- `apps/kalio-api/src/modules/hitl/hitl-config.service.ts`
- `apps/kalio-api/src/modules/hitl/hitl-config.controller.ts`
- `apps/kalio-api/src/modules/hitl/hitl-decision.service.ts`
- `apps/kalio-api/src/modules/hitl/hitl-policy.service.ts`
- `apps/kalio-api/src/modules/chat/tool-dispatch.service.ts`
- `apps/kalio-api/src/modules/raapp/raapp-hitl.service.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-draft.tools.ts`
- `apps/kalio-api/src/app.module.ts`
- `apps/kalio-api/src/modules/chat/chat.module.ts`
- `apps/kalio-api/src/modules/raapp/raapp.module.ts`
- `apps/kalio-web/src/features/settings/HITLSettingsPanel.tsx`
- `apps/kalio-web/src/features/settings/registry.tsx`
- Focused backend and frontend test files for the new HITL flow

## Decisions made

- Kept `manual` as the persisted default to preserve existing behavior.
- Kept the HITL config local to backend/frontend modules instead of modifying `packages/@kalio/types` for this change.
- For RA-App approvals, `auto` only executes when the full batch is approved; any rejection or evaluation failure falls back to manual rather than partially cancelling the batch.
- Auto approval evaluator failures, invalid JSON, or missing persona state all fall back to `manual` rather than bypass.
- The auto evaluator uses the current active runtime LLM path through `LLMService`; it does not switch models based on `persona.model`.

## Validation

- Passed focused backend tests for:
  - `ToolDispatchService`
  - HITL config service/controller
  - HITL policy service
  - RA-App HITL service
  - `run_raapp`
  - `raapp_execute_dsl`
- Passed focused frontend tests for:
  - `HITLSettingsPanel`
  - Settings registry entry
- Ran `tsc --noEmit` successfully for both `apps/kalio-api` and `apps/kalio-web`.

## Open questions

- No manual browser smoke test was run against a live UI/API session in this task; validation relied on focused tests and typechecks.
- The auto evaluator contract is strict JSON, but no dedicated UI surface was added to show the evaluator's `reason` to the user yet.

## Next steps

- If needed, add an end-to-end test covering switching the HITL mode in Settings and observing one tool confirmation plus one RA-App approval across `manual`, `auto`, and `bypass`.