# 2026-05-02 — Image Module Fixes (Phase 2 Review)

## What was done

Addressed review findings in the image module (Phase 2 of code review cycle).

### Bug #5: `resolveBaseUrl(undefined)` in polling URL rewrite
**File**: `apps/kalio-api/src/modules/image/image-generation.service.ts` (line ~394)

**Problem**: When a Replicate polling URL (`api.replicate.com/...`) is returned from the initial prediction POST, the code rewrites it through the configured proxy. But it called `resolveBaseUrl(undefined)` — which ignores the per-request custom `baseUrl` — always defaulting to cometapi even when a custom proxy was configured.

**Fix**: Replaced `resolveBaseUrl(undefined)` with the already-resolved `baseUrl` variable (computed at the top of `generate()`).

**Test lesson**: Initial test was a false positive — it found the first POST call (to `my-proxy.example.com`) via `.find()`, not the polling GET call. Fixed by checking specifically for the call whose URL contains `/predictions/test-id`.

---

### Bug #6: `writeBinary` outside try/catch in `image-edit.tool.ts`
**File**: `apps/kalio-api/src/modules/tool/tools/image-edit.tool.ts` (line ~251)

**Problem**: `this.vfs.writeBinary(...)` is synchronous and can throw (e.g. ENOSPC). Without a try/catch, the exception propagates out of `execute()` — crashing the tool call instead of returning a clean `{ error }` result.

**Fix**: Wrapped `writeBinary` in try/catch with `logger.error` + `return { error: '...' }`.

---

### Minor fixes
- `image-generation.service.ts`: Removed redundant `!` on `PROVIDER_BASE_URLS['cometapi']` (used as `??` fallback — `!` is unnecessary and misleading)
- `image-edit.tool.ts`: Removed redundant `!` on `MODEL_MAP['flash']` (same pattern)
- `image-utils.ts`: `fetchAndConvertImage` now throws early if data URL has no comma separator (`indexOf(',') === -1`)

## Files touched
- `apps/kalio-api/src/modules/image/image-generation.service.ts`
- `apps/kalio-api/src/modules/image/image-generation.service.spec.ts` (new, redesigned to catch false positive)
- `apps/kalio-api/src/modules/tool/tools/image-edit.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/image-edit.tool.spec.ts` (new)
- `apps/kalio-api/src/modules/image/image-utils.ts`

## Test results
- 4/4 image-related new tests pass (2 image-gen service, 2 image-edit tool)
- TypeScript: clean, no errors

## Open questions
- `ImageSettingsPanel.tsx`: Compression config always sent even when compression is disabled — minor, worth a future cleanup
