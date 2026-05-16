# Session: RA-App V2 merge readiness

**Date**: 2026-05-10 18:03  
**Topic**: full Vitest verification, legacy cleanup, and RA-App V2 architecture doc

---

## What Was Done

This session focused on the RA-App V2 branch before merge.

### Verification performed

1. **Frontend full Vitest**
   - Result: passing
   - Status: `37` files, `369` tests

2. **Backend full Vitest**
   - Result: passing after stabilizing one flaky spec
   - Status: `102` files, `1277` tests

3. **Focused backend validation after cleanup**
   - `src/modules/tool/tools/raapp-crud.tools.spec.ts`: passing (`2` tests)
   - Edited files checked for language-service errors: no errors found

4. **RA-App Playwright slice**
   - Existing RA-App-oriented E2E specs were run
   - Result: not fully green
   - Passing smoke coverage: landing page tiles, tool registry, ECS socket snapshot
   - Failing coverage: `tests/ac-raapp-ecs-live.spec.ts` in the `run_raapp returns GUI block for Visual Calculator` scenario
   - Failure shape: chat input remains disabled and does not re-enable after launch

### Backend test stabilization

`effects-processor.service.spec.ts` was flaky in the full suite because the whole file mocked the VM timeout to `7ms` through `ConfigService`. That was acceptable in isolated runs but too aggressive for full-suite execution.

The fix was to:

- use a realistic default timeout for the file
- create a dedicated fixture with `7ms` only for the single assertion that checks timeout propagation
- restore the `vm.runInContext` spy locally in the owning test

### Legacy cleanup decision

`RAAppService.updateApp()` was audited and removed.

Reason:

- no active TypeScript call sites remained
- the intended edit flow is now `raapp_edit` -> VFS working copy -> `raapp_publish_draft`
- keeping `updateApp()` would preserve the obsolete ZIP-in-place edit model next to the VFS-first flow

---

## Files Touched

### Code

- `apps/kalio-api/src/modules/raapp/effects-processor.service.spec.ts`
- `apps/kalio-api/src/modules/raapp/raapp.service.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-crud.tools.spec.ts`
- `apps/kalio-api/vitest.config.ts` (temporary broad change was reverted during debugging)

### Docs

- `docs/raapp-v2-architecture-current.md`
- `docs/raapp-design-current.md`
- `docs/sessions/2026-05-10-18-03-raapp-v2-merge-readiness.md`

---

## Decisions Made

1. **`updateApp()` should be removed now**
   The main RA-App editing flow is already VFS-first, and the old in-place release mutation path is dead.

2. **Manager already exists and is aligned with V2**
   `RAAppManager` is already the live manager surface, with `Catalog`, `Work`, and `Session` sections.

3. **Homepage/catalog dedupe is already partially unified**
   `LandingPage` and `RAAppManager` both rely on `bucketCatalogApps()` to filter grouped current/draft/history IDs out of the flat user list.

4. **Agent guidance is materially better than before**
   Persona prompts now split launch, build, and design flows:
   - RaConsierge for launch (`list_raapps` -> `run_raapp`)
   - RaBuilder for draft-first authoring
   - Designer for VFS-first HTML preview loops

5. **Persistence is still not fully unified**
   The remaining split is one-shot `raapp_create` / `saveGeneratedApp()` writing standalone flat ZIPs, while draft-first publish uses grouped versioned storage.

---

## Open Questions

1. **Should one-shot `raapp_create` also feed the grouped versioned release lane?**
   That is the clearest remaining architectural unification step.

2. **Should the failing Playwright spec be fixed before merge, or is it an accepted follow-up?**
   Unit/integration confidence is strong, but RA-App E2E is not fully green yet.

3. **Do we want new E2E coverage for the VFS-first lifecycle itself?**
   There is still no end-to-end test for the full `raapp_edit` / `raapp_test` / `raapp_publish_draft` flow through the UI.

---

## Natural Next Steps

1. Fix the `ac-raapp-ecs-live.spec.ts` disabled-input regression after `run_raapp`.
2. Add an E2E covering draft-first edit/test/publish from the manager or chat flow.
3. Decide whether standalone `raapp_create` outputs should be promoted into grouped versioned storage automatically.