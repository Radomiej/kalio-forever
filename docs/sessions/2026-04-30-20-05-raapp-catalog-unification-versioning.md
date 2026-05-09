# Session: RA-App Catalog Unification + Versioning

**Date**: 2026-04-30  
**Duration**: ~2 sessions (continued from prior)

## What Was Done

Unified the RA-App catalog (Home vs Tools→RA-Apps split) and ported versioning features from the reference implementation at `C:\Projekty\ra-kingdom-stack`.

### Root Cause of the Split
- `LandingPage` fetched `GET /api/ra-apps` (disk catalog of pre-built ZIPs)
- `RAAppManager` scanned Zustand session messages for inline `raapp_create` tool results
- They were reading completely different data sources, never unified

### Solution: 8-Phase Implementation

**Phase 1 — `@kalio/types`**  
Added 4 new shared interfaces:
- `RAAppSummary` — flat summary of any RA-App (core or user)
- `RAAppVersionInfo` — single version entry (current/draft/archived)
- `RAAppMetaSummary` — meta.yml fields subset
- `RAAppGroup` — slug + current + draft? + history[]

**Phase 2 — `RAAppVersioningService`** (new, ~350 LOC)  
`apps/kalio-api/src/modules/raapp/raapp-versioning.service.ts`
- Disk layout: `{userDir}/{slug}/current.zip`, `draft.zip`, `history/{version}.zip`, `.manifest.json`
- Methods: `init`, `getGroups`, `getGroupBySlug`, `saveAsDraft`, `approveDraft`, `discardDraft`, `rollback`, `deleteGroup`
- Migration: `migrateFlatZips()` — one-time idempotent migration from legacy flat ZIPs
- Helpers exported: `parseSemver`, `bumpVersion`, `deriveSlug`
- Uses `ConfigService.get('RA_APPS_PATH', './data/ra-apps')` — userDir = `{base}/user`
- Implements `OnModuleInit`

**Phase 3 — Controller + Module**  
- `raapp.module.ts`: added `RAAppVersioningService` to providers + exports
- `raapp.controller.ts`: removed local `RAAppSummary` duplicate; injected versioning service; added 7 new endpoints under `/ra-apps/groups/*`

**Phase 4 — `apiClient.ts`**  
8 new typed helper functions for FE: `getRAApps`, `getRAAppGroups`, `uploadRAApp`, `uploadRAAppDraft`, `approveRAAppDraft`, `discardRAAppDraft`, `rollbackRAApp`, `deleteRAAppGroup`

**Phase 5 — New UI Components**  
- `RAAppGroupCard.tsx` (~200 LOC): versioned user app card with draft/approve/rollback UI
- `RAAppCoreCard.tsx` (~50 LOC): read-only core app card

**Phase 6 — `RAAppManager.tsx` overhaul**  
- Old: only scanned session messages for `raapp_create` results
- New: dual-source — catalog section (fetches API) + session section (preserves original logic)
- Drag-and-drop ZIP upload + refresh button

**Phase 7 — Unit Tests**  
`raapp-versioning.service.spec.ts`: 21 tests, real filesystem, real ZIPs built with archiver

## Verification Results

| Check | Result |
|-------|--------|
| `tsc --noEmit` (API) | ✅ 0 errors |
| `tsc --noEmit` (Web) | ✅ 0 errors |
| Versioning spec (21 tests) | ✅ 21/21 pass |
| Full API test suite (772 tests) | ✅ 772/772 pass |
| Full Web test suite | ✅ 212/216 pass (4 pre-existing LLMPanel.test.tsx failures, unrelated) |

## Files Touched

- `packages/@kalio/types/src/index.ts` — added 4 new interfaces
- `apps/kalio-api/src/modules/raapp/raapp-versioning.service.ts` — NEW
- `apps/kalio-api/src/modules/raapp/raapp-versioning.service.spec.ts` — NEW
- `apps/kalio-api/src/modules/raapp/raapp.module.ts` — added service
- `apps/kalio-api/src/modules/raapp/raapp.controller.ts` — removed local type duplicate, added 7 endpoints
- `apps/kalio-web/src/services/apiClient.ts` — added 8 API helpers
- `apps/kalio-web/src/features/raapp/components/RAAppGroupCard.tsx` — NEW
- `apps/kalio-web/src/features/raapp/components/RAAppCoreCard.tsx` — NEW
- `apps/kalio-web/src/features/raapp/RAAppManager.tsx` — full overhaul

## Decisions Made

- Used `archiver` + `extract-zip` + `js-yaml` (already in deps) — no new dependencies
- Migration (`migrateFlatZips`) is idempotent so existing flat-ZIP deployments aren't broken
- `RAAppManager` keeps dual sources (catalog API + session messages) to not break existing inline tool result display
- `LandingPage.tsx` was not modified — it already correctly fetches `/api/ra-apps`

## Open Questions / Next Steps

- E2E tests for versioning flow (upload → draft → approve → rollback) could be added
- The `handleDraftUpload` from `RAAppGroupCard` expects the FE to accept a `File` object; the controller uses `FileInterceptor('file')` — standard multipart
- History is listed in reverse-chronological order inside `RAAppGroupCard`; consider pagination if history grows large
