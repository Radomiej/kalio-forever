# 2026-05-02 — Image Module: FLUX Hang Fix + Tests

## What was done

### Root cause fixed: FLUX hung on CometAPI
- CometAPI (`https://api.cometapi.com/v1`) is an OpenAI-compatible proxy
- Old code detected `flux` in model name → routed to Replicate async prediction polling → timed out (120s)
- Fix: `isOpenAICompatProxy(baseUrl, provider)` — returns `false` ONLY for `provider='replicate'` or `api.replicate.com` URLs; any URL ending in `/v1` is OpenAI-compat

### Providers expanded
- Added `replicate` as first-class `ImageProviderType` in `@kalio/types`
- `PROVIDER_BASE_URLS` includes `replicate: 'https://api.replicate.com/v1'`
- Replicate direct: FLUX uses native prediction polling on `api.replicate.com`
- Any other `/v1` endpoint: FLUX uses standard `POST /v1/images/generations`

### `image-generation.service.ts` rewritten
- `getModelConfig(modelName, baseUrl, apiKey, provider?)` — 4-param signature
- FLUX on OpenAI-compat → `openai-standard` family (no polling)
- FLUX on `provider='replicate'` → `flux` family (async polling)
- Polling: 30 attempts × 3s (was 60 × 2s); robust URL extraction via `selectBestImageUrl`
- `extractImageFromResponse` handles `data[0].url` and top-level `url`

### Settings panel updated (`ImageSettingsPanel.tsx`)
- Added `replicate` provider with base URL and default model
- Added model quick-select chips per provider (CometAPI/Replicate pre-defined models)

### Tests added
- `image-config.service.spec.ts` — 9 integration tests (in-memory SQLite), all pass
- `image-generation.service.spec.ts` — 9 unit tests (vi.fn() fetch mock)
  - FLUX on CometAPI → no polling (1 fetch call)
  - FLUX on any `/v1` URL → standard endpoint
  - dall-e-3 → `response_format=b64_json`
  - gpt-image-1 → `output_format+quality`
  - FLUX on `provider=replicate` → prediction polling (3 fetch calls)
  - Replicate polling URL rewritten to configured baseUrl
  - HTTP error / no image data → throws

### `.env.test` updated
```
IMAGE_PROVIDER=cometapi
IMAGE_API_KEY=sk-yerb077aLBtnsc7Vr7aZVc8Rdo7cDvYstSlgtjvF1yQFAapR
IMAGE_BASE_URL=https://api.cometapi.com/v1
IMAGE_MODEL=flux-schnell
```

## Files touched
- `packages/@kalio/types/src/index.ts` — added `replicate` to `ImageProviderType`
- `apps/kalio-api/src/modules/image/image-generation.service.ts` — full rewrite
- `apps/kalio-api/src/modules/image/image-generation.service.spec.ts` — new test suite
- `apps/kalio-api/src/modules/image/image-config.service.spec.ts` — new integration tests
- `apps/kalio-api/src/modules/tool/tools/image-generate.tool.ts` — added `replicate` to supported providers
- `apps/kalio-web/src/features/settings/ImageSettingsPanel.tsx` — replicate + model chips
- `.env.test` — image provider config

## Final state
- Typechecks: ✅ API clean, ✅ Web clean
- Tests: ✅ 18/18 pass (9 config + 9 generation)
