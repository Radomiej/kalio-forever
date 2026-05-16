# RA-App VFS edit -> publish workflow

## What was done

- Moved `raapp_edit` from in-place release ZIP mutation to a VFS-first workflow.
- `raapp_edit` now creates or updates a stable working copy at `drafts/edit-<appId>` in the active session.
- Added `raapp_publish_draft` to publish raw VFS drafts into the versioned release lifecycle.
- Wired the new publish tool into `ToolModule`, `ToolRegistryService`, and the registry canary spec.
- Added direct Work section actions in the frontend manager for `test`, `run`, and `publish`.
- Updated the built-in `RaBuilder` persona to understand `raapp_edit -> raapp_test -> raapp_publish_draft`.

## Files touched

- `apps/kalio-api/src/modules/tool/tools/raapp-crud.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-crud.tools.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-draft.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-draft.tools.spec.ts`
- `apps/kalio-api/src/modules/tool/tool.module.ts`
- `apps/kalio-api/src/modules/tool/tool-registry.service.ts`
- `apps/kalio-api/src/modules/tool/tool-registry.service.spec.ts`
- `apps/kalio-api/src/assets/personas.json`
- `apps/kalio-web/src/features/raapp/RAAppManager.tsx`
- `apps/kalio-web/src/features/raapp/RAAppManager.test.tsx`

## Decisions

- Published releases are no longer the editable surface; the editable surface is the session VFS working copy.
- The stable edit draft naming scheme is `drafts/edit-<appId>` so repeated edits stay on the same working copy.
- Work section actions use the existing `pendingMessage` + Talk auto-send flow instead of inventing a new frontend tool executor.
- `raapp_publish_draft` uses the existing versioning service so release semantics remain centralized.
- Draft `.mode` and `.raapp-slug` stay as VFS-side control files and are not stored as release payload files.

## Validation

- `apps/kalio-api`: `vitest run src/modules/tool/tools/raapp-crud.tools.spec.ts src/modules/tool/tools/raapp-draft.tools.spec.ts src/modules/tool/tool-registry.service.spec.ts src/modules/persona/persona.service.spec.ts`
- `apps/kalio-web`: `vitest run src/features/raapp/RAAppManager.test.tsx`
- `apps/kalio-api`: `tsc --noEmit`
- `apps/kalio-web`: `tsc --noEmit`
- IDE errors on touched files: clean

## Open questions / next steps

- The Work section now triggers agent actions, but it still does not show inline test output or publish status history; that could be added later if needed.
- `raapp_get` still reads from released sources only. If users want diffing between release and working copy, that needs a dedicated follow-up.
- A future UX improvement could expose bump type choice (`patch/minor/major`) directly in the Work publish button flow.