# Session: RA-App review fixes

**Date**: 2026-05-10 18:09  
**Topic**: apply relevant RA-App review fixes with fail-first tests

---

## What Was Done

This session reviewed a batch of RA-App code review findings and applied the ones that were both reproducible and locally fixable without reopening broader architecture decisions.

### Accepted and fixed

1. **`raapp_publish_draft` empty-slug guard**
   - Added a fail-first test proving a draft with empty `meta.id` and `meta.name` could still publish.
   - Fixed publish slug resolution so it now accepts the first non-empty value from:
     - `.raapp-slug`
     - `meta.yml id`
     - slug derived from `meta.yml name`
   - If none exist, the tool now returns a validation error instead of writing into the versioning root.

2. **`raapp_edit` now accepts `components_yml`**
   - Added a fail-first test covering `components_yml` update requests.
   - Updated tool schema, file map, and validation message so `components.yml` can be edited through the VFS-first flow.

3. **VM timeout cap in `EffectsProcessorService`**
   - Added a fail-first test showing an oversized config value was passed directly to `vm.runInContext`.
   - Introduced a `30_000ms` maximum cap while preserving the default timeout behavior.

4. **Consistent `raapp_test` behavior for missing `systems.yml`**
   - Added a fail-first test for stored releases with `tests.yml` but no `systems.yml`.
   - Updated the tool to return a validation error for releases just like drafts, instead of silently running with empty output.

5. **Release download error hardening**
   - Added a fail-first service test proving `downloadRelease()` did not throw when the release ZIP was missing on disk.
   - Added a fail-first controller test proving code-based release-not-found classification was not mapped to `404`.
   - Fixed `RAAppVersioningService.downloadRelease()` to:
     - preflight the release path with `statSync`
     - throw a typed `RAAPP_RELEASE_NOT_FOUND` code when the release artifact is gone
     - log late stream failures
   - Updated `RAAppController.downloadRelease()` to map the typed code to `NotFoundException`.

6. **`zip-archive.util.ts` cleanup logging**
   - Added a fail-first test for rejected `cleanupOnError()`.
   - The helper now logs cleanup failures before rejecting with the original archive error.

### Reviewed but intentionally not changed in this pass

1. **Duplicated resize-bridge injection**
   - Real observation, but not a small bugfix. Extracting this safely crosses frontend/backend runtime boundaries and is better handled as a dedicated cleanup task.

2. **`RAAppRenderer` missing VFS preview fallback UI**
   - Also reasonable, but it is a frontend UX change with new rendering/error states, not a contained backend correctness fix.

3. **Removing `RAAppService.executeSystems()`**
   - Not treated as dead code in this pass because it still has its own explicit spec coverage and removal would be an API/cleanup decision, not a review hotfix.

---

## Files Touched

- `apps/kalio-api/src/modules/tool/tools/raapp-draft.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-crud.tools.ts`
- `apps/kalio-api/src/modules/raapp/effects-processor.service.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-test.tools.ts`
- `apps/kalio-api/src/modules/raapp/raapp-versioning.service.ts`
- `apps/kalio-api/src/modules/raapp/raapp.controller.ts`
- `apps/kalio-api/src/modules/raapp/zip-archive.util.ts`

- `apps/kalio-api/src/modules/tool/tools/raapp-draft.tools.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-crud.tools.spec.ts`
- `apps/kalio-api/src/modules/raapp/effects-processor.service.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-test.tools.spec.ts`
- `apps/kalio-api/src/modules/raapp/raapp.controller.spec.ts`
- `apps/kalio-api/src/modules/raapp/raapp-versioning.service.spec.ts`
- `apps/kalio-api/src/modules/raapp/zip-archive.util.spec.ts`

---

## Validation

### Focused fail-first / fix verification

Focused backend slice run:

- `raapp-draft.tools.spec.ts`
- `raapp-crud.tools.spec.ts`
- `effects-processor.service.spec.ts`
- `raapp-test.tools.spec.ts`
- `raapp.controller.spec.ts`
- `raapp-versioning.service.spec.ts`
- `zip-archive.util.spec.ts`

Result after fixes: `7` files passed, `116` tests passed.

### Full backend verification

Full backend Vitest run after the review fixes:

- `102` test files passed
- `1284` tests passed

Language-service error check on all edited implementation files: no errors found.

---

## Key Decisions

1. Review findings were applied only when they had a clear repro and a small, defensible fix.
2. The release download path now has a typed not-found signal instead of depending only on message text.
3. Lower-priority architecture/UI observations were deferred rather than mixed into a bugfix pass.

---

## Natural Next Steps

1. Add a frontend fallback for expired/missing VFS previews in `RAAppRenderer` / `VfsHtmlRenderer`.
2. Decide whether to remove `RAAppService.executeSystems()` as a deliberate API cleanup.
3. Consider a follow-up cleanup for the duplicated resize bridge used by VFS-served HTML and inline `srcDoc` HTML.