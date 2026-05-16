# Session: RA-App persistence, versioning, deploy review

Date: 2026-05-10 00:09
Branch: feature/raapp-v2

## What was reviewed
- Backend persistence flow for stored RA-Apps
- Version bump + approve/rollback lifecycle
- RAAppManager catalog behavior
- Portability of stored ZIPs across machines
- Runtime storage path in dev

## Key findings
- RA-App persistence is local-disk based and in dev resolves to `apps/kalio-api/data/ra-apps` because `start-dev.ps1` starts Nest with working directory `apps/kalio-api`.
- `RAAppService.saveGeneratedApp()` still writes flat ZIPs into `user/`, while `RAAppVersioningService` manages versioned folders (`current.zip`, `draft.zip`, `history/`) and only migrates flat ZIPs on init.
- RAAppManager intentionally supports both sources: grouped apps from `/api/ra-apps/groups` and standalone user apps from `/api/ra-apps`.
- Version bump semantics are server-owned: approval computes the next version from the current release and patches `meta.yml` in `current.zip`.
- ZIP portability is good for self-contained apps, but HTML apps do not get asset serving from inside the ZIP; only `main.html` / `index.html` rendered via iframe `srcDoc`.
- There is no first-class export/download endpoint or UI action for stored RA-Apps; sharing is currently filesystem-copy or manual re-upload.
- There is a startup-order risk: both `RAAppService` and `RAAppVersioningService` implement `OnModuleInit`, but only the versioning service migrates flat ZIPs. If RAAppService loads first, it can keep stale paths to ZIPs that migration then moves.

## Evidence checked
- `apps/kalio-api/src/modules/raapp/raapp.service.ts`
- `apps/kalio-api/src/modules/raapp/raapp-versioning.service.ts`
- `apps/kalio-api/src/modules/raapp/raapp.controller.ts`
- `apps/kalio-api/src/modules/raapp/raapp.module.ts`
- `apps/kalio-web/src/features/raapp/RAAppManager.tsx`
- `apps/kalio-web/src/features/raapp/catalog.utils.ts`
- `apps/kalio-web/src/services/apiClient.ts`
- `apps/kalio-web/src/features/raapp/HtmlIframeRenderer.tsx`
- Runtime disk contents under `apps/kalio-api/data/ra-apps/user/`

## Open questions
- Should `raapp_create` persist directly into the versioned group layout instead of flat ZIPs?
- Should there be an explicit export/download endpoint for sharing apps between users or machines?
- Should version strings be strictly validated against SemVer instead of permissive coercion?

## Next steps
1. Unify persistence so generated apps enter the versioned layout immediately.
2. Add an API/UI download action for `current.zip` and optionally historical versions.
3. Make startup ordering explicit or let `RAAppService` depend on already-migrated storage.
4. Set `RA_APPS_PATH` to a mounted persistent volume in production deployments.
