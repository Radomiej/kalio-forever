# Session: raapp_create versioned storage

**Date**: 2026-05-11 01:13

## What was done

- Reworked `raapp_create` so new generated apps no longer persist through `RAAppService.saveGeneratedApp()`.
- Added a generated release-archive build step inside `RaAppCreateTool` that builds a ZIP artifact with `meta.yml` plus `main.html` or `ui.gui`.
- Saved that artifact through `RAAppVersioningService.saveAsDraft(...)` using a generated unique app ID/slug, then reloaded the RA-App catalog through `RAAppService.init()`.
- Updated the dedicated `RaAppCreateTool` unit tests to assert versioned storage behavior and catalog reload.
- Updated the secondary regression test in `raapp.tools.spec.ts` to the new storage contract.

## Files touched

- `apps/kalio-api/src/modules/tool/tools/raapp.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-create.tools.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp.tools.spec.ts`

## Validation

- `node_modules\\.bin\\vitest.cmd run src/modules/tool/tools/raapp-create.tools.spec.ts src/modules/tool/tools/raapp.tools.spec.ts`
- VS Code file diagnostics for the touched files: no errors

## Decisions

- Kept generated app IDs unique (`generated-<session>-<uuid8>`) so `raapp_create` now lands in the versioned lifecycle without changing its current user-facing semantics into implicit updates of an existing slug.
- Did not remove `RAAppService.saveGeneratedApp()` yet; it is now legacy/unused and can be removed in a follow-up cleanup once the broader release-build path is consolidated.

## Next steps

1. Move the generated ZIP-building logic into a dedicated shared build service so draft publish and one-shot create converge on the same artifact builder.
2. Add published HTML asset serving so versioned HTML releases are not limited to inline `main.html` rendering.
3. After the release lane is fully unified, expose current releases with `expose_as_tool: true` as dynamic tools.