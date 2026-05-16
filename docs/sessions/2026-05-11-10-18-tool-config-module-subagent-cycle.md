# 2026-05-11 10:18 - Tool config module and subagent cycle break

## What was done

- Added a dedicated application-level tool composition module in `apps/kalio-api/src/config/tool-application-config.module.ts`.
- Moved the wide cross-domain tool wiring out of `apps/kalio-api/src/modules/tool/tool.module.ts`.
- Added `TOOL_CATALOG` and a lightweight tool metadata port for subagent persona filtering.
- Updated `SubagentTool` to use the lightweight catalog instead of reaching into `ToolRegistryService` through `ModuleRef`.
- Added a `tool.module.spec.ts` contract test to keep `ToolModule` thin.
- Updated `subagent.tool.spec.ts` to lock in the no-registry-service-locator behavior.

## Files touched

- `apps/kalio-api/src/config/tool-application-config.module.ts`
- `apps/kalio-api/src/modules/tool/tool-catalog.port.ts`
- `apps/kalio-api/src/modules/tool/tool.providers.ts`
- `apps/kalio-api/src/modules/tool/tool.module.ts`
- `apps/kalio-api/src/modules/tool/tool.module.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/subagent.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/subagent.tool.spec.ts`

## Decisions made

- Kept `ToolRegistryService` as the runtime dispatch registry to avoid widening the refactor into chat dispatch.
- Broke the `ToolRegistryService` ↔ `SubagentTool` cycle by separating tool metadata lookup from executable registry entries.
- Left `ToolController` on `ToolRegistryService`, because it mutates registry overrides and needs executable entries, not only metadata.

## Validation

- `apps/kalio-api`: `vitest run src/modules/tool/tools/subagent.tool.spec.ts src/modules/tool/tool.module.spec.ts` ✅
- `apps/kalio-api`: `tsc --noEmit` ⚠️ blocked by pre-existing unrelated errors in `src/modules/tool/tools/raapp-create.tools.spec.ts`
- Touched files checked separately with diagnostics: no errors.

## Open questions

- `ChatModule` still reads executable entries from `ToolRegistryService`; if we continue the pseudo-module cleanup, the next step is to hide that behind a dedicated dispatch-facing port.

## Next steps

1. Extract a dispatch-facing port for chat so `ChatModule` no longer imports `ToolRegistryService` directly.
2. Decide whether `ToolController` should keep mutating the registry directly or move overrides behind a dedicated service.
3. Fix the unrelated `raapp-create.tools.spec.ts` typing drift so backend `tsc --noEmit` is green again.