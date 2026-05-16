# 2026-05-XX — RA-App V1→V2 Migration: Complete

## What was done

Full migration of RA-App logic from V1 (ra-kingdom-stack) to V2 (kalio-forever).

## Files touched

### New files
- `apps/kalio-api/src/modules/raapp/entity-store.ts` — ECS state container (plain class, not @Injectable, instantiated per execution)
- `apps/kalio-api/src/modules/raapp/entity-store.spec.ts` — Full unit test suite for EntityStore
- `apps/kalio-api/src/modules/tool/tools/raapp-crud.tools.ts` — RaAppGetTool, RaAppEditTool, RaAppDeleteTool
- `apps/kalio-api/src/modules/tool/tools/raapp-draft.tools.ts` — RaAppCreateDraftTool, RaAppExecuteDslTool
- `apps/kalio-api/src/modules/tool/tools/raapp-test.tools.ts` — RaAppTestTool

### Modified files
- `apps/kalio-api/src/modules/raapp/effects-processor.service.ts` — ECS effects (create_entity, delete_entity, set_field), query-based system iteration, math helpers (VM_MATH), `entities` in result
- `apps/kalio-api/src/modules/tool/tools/raapp.tools.ts` — RunRaAppTool uses EntityStore per execution
- `apps/kalio-api/src/modules/raapp/raapp.service.ts` — Added `getSourceFiles()` + `updateApp()` methods
- `apps/kalio-api/src/modules/tool/tool-registry.service.ts` — Registered 6 new tools
- `apps/kalio-api/src/modules/tool/tool.module.ts` — Added 6 new tool providers
- `apps/kalio-api/src/modules/tool/tool-registry.service.spec.ts` — Updated tool count + imports
- `apps/kalio-api/src/modules/tool/tools/raapp.tools.spec.ts` — Updated mocks for new call signature

## Decisions

- EntityStore is a plain class (`new EntityStore()` per run), not @Injectable — per V1 pattern
- ECS query loop built into EffectsProcessorService (no separate SystemLoopService needed)
- VM module used for expressions (already in V2), no new dependency
- Draft storage via session VFS: `sessions/{sessionId}/drafts/{draftId}/`
- Three.js/Tone.js templates NOT migrated (post-MVP per GAP_ANALYSIS)

## Result

- 97 test files, 1241 tests — all passing
- 0 TypeScript errors
- 6 new tools: `raapp_get`, `raapp_edit`, `raapp_delete`, `raapp_create_draft`, `raapp_execute_dsl`, `raapp_test`
