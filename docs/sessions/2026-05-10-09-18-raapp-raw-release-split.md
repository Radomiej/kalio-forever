# RA-App raw VFS + release ZIP split

## What was done

- Added TDD coverage first for three gaps: release ZIP download endpoint, raw work drafts in RAAppManager, and `raapp_test` support for VFS drafts.
- Implemented backend release download flow at `GET /api/ra-apps/groups/:slug/download/:version`.
- Added `RAAppVersioningService.downloadRelease()` to resolve current or historical releases by semantic version and stream a versioned filename.
- Extended `raapp_test` so it can run against either stored releases (`id`) or raw VFS drafts (`draft_id`).
- Added raw Work section to RAAppManager using existing session VFS endpoints.
- Added release download actions to grouped RA-App cards for current and historical versions.
- Wired the RA-App manager `Open VFS` action to the existing Mind -> Files view in the app shell.

## Files touched

- `apps/kalio-api/src/modules/raapp/raapp.controller.ts`
- `apps/kalio-api/src/modules/raapp/raapp.controller.spec.ts`
- `apps/kalio-api/src/modules/raapp/raapp-versioning.service.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-test.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-test.tools.spec.ts`
- `apps/kalio-web/src/services/apiClient.ts`
- `apps/kalio-web/src/features/raapp/RAAppManager.tsx`
- `apps/kalio-web/src/features/raapp/RAAppManager.test.tsx`
- `apps/kalio-web/src/features/raapp/components/RAAppGroupCard.tsx`
- `apps/kalio-web/src/features/raapp/components/RAAppGroupCard.test.tsx`
- `apps/kalio-web/src/App.tsx`

## Decisions

- Raw work stays in session VFS under `drafts/<id>`; it is not represented as `current.zip`.
- Released artifacts stay in versioned RA-App groups and are downloaded as `<slug>-<version>.zip`.
- The manager should show raw work and releases as separate surfaces instead of mixing their semantics.
- Draft testing belongs in `raapp_test` so the draft-first workflow can validate before publish.

## Validation

- `apps/kalio-api`: `vitest run src/modules/raapp/raapp.controller.spec.ts src/modules/tool/tools/raapp-test.tools.spec.ts`
- `apps/kalio-web`: `vitest run src/features/raapp/RAAppManager.test.tsx src/features/raapp/components/RAAppGroupCard.test.tsx`
- `apps/kalio-api`: `tsc --noEmit`
- `apps/kalio-web`: `tsc --noEmit`
- IDE errors check on all touched files: clean

## Open questions / next steps

- `raapp_edit` still edits stored release artifacts directly; the next step should likely move edit flows toward VFS working copies first.
- The current release download surface is REST-only; if users need richer metadata or bulk export, that should be a separate follow-up.
- Manager Work currently summarizes draft files and links to Files view; richer inline actions like test/run/publish can be layered on top later.