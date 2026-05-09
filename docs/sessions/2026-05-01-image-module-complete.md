# Image Module Migration — Complete

## What was done

Migrated image generation/editing feature from `ra-kingdom-stack` legacy codebase to `kalio-forever` as a dedicated `ImageModule`.

## Files created

### Backend
- `apps/kalio-api/src/modules/image/image-utils.ts` — buffer/base64 helpers
- `apps/kalio-api/src/modules/image/image-generation.service.ts` — multi-provider generation (CometAPI/OpenAI/OpenRouter, FLUX/Kling async polling)
- `apps/kalio-api/src/modules/image/image-config.service.ts` — config persistence via `app_settings` table
- `apps/kalio-api/src/modules/image/image-config.controller.ts` — `GET/PUT /api/image/config`
- `apps/kalio-api/src/modules/image/image.module.ts` — NestJS module
- `apps/kalio-api/src/modules/tool/tools/image-generate.tool.ts` — `image_generate` tool
- `apps/kalio-api/src/modules/tool/tools/image-edit.tool.ts` — `image_edit` tool (Gemini via CometAPI)
- `apps/kalio-api/src/modules/tool/tools/image-view.tool.ts` — `image_view` tool

### Frontend
- `apps/kalio-web/src/features/settings/ImageSettingsPanel.tsx` — Settings → Image Generation config panel
- `apps/kalio-web/src/features/chat/ImageResultRenderer.tsx` — inline image renderer with download, full-size modal, metadata strip

## Files modified
- `packages/@kalio/types/src/index.ts` — new image types
- `apps/kalio-api/src/app.module.ts` — added ImageModule
- `apps/kalio-api/src/modules/tool/tool.module.ts` — added 3 image tools
- `apps/kalio-api/src/modules/tool/tool-registry.service.ts` — injected 3 image tools
- `apps/kalio-api/src/modules/tool/tool-registry.service.spec.ts` — added 3 image tool stubs + expected names
- `apps/kalio-web/src/features/settings/registry.tsx` — added Image Generation tab
- `apps/kalio-web/src/features/chat/ToolCallBubble.tsx` — `extractImageResult()` helper + render in Live/History bubbles

## Decisions
- Config persisted as JSON blob in `app_settings` table (key: `image_config`) — no new migration needed
- API key never returned in `GET /api/image/config` — presence indicated by `source: 'db'`
- `image_edit` uses Gemini via CometAPI proxy (`/v1beta/models/{model}:generateContent`) with `x-goog-api-key` header
- `output_type: 'image'` discriminator field in tool results triggers inline rendering

## Verification
- `apps/kalio-api` typecheck: 0 errors
- `apps/kalio-web` typecheck: 0 errors
