# 2026-04-29 — Embeddings Providers Tab + Web Search Tool

## What was done

### New feature: `app_settings` DB table
- Added `appSettings` table to `schema.ts` (key TEXT PK, value TEXT, updated_at INTEGER)
- Created migration `0001_app_settings.sql`
- Created `AppSettingsService` in `database/` — `get/set/delete/getAll(prefix)`, injected globally via `DatabaseModule`

### New feature: Embeddings Providers settings tab
- Extended `EmbeddingService` with `OnModuleInit` + `reconfigure()`:
  - On startup: loads persisted config from `app_settings` (keys: `embedding.api_key`, `embedding.base_url`, `embedding.model`, `embedding.dimensions`)
  - `reconfigure()` writes to DB and swaps the in-memory provider
- Added `EmbeddingService` constructor arg `AppSettingsService`; propagated to `MemoryService` (which manually instantiates `EmbeddingService`)
- Added endpoints to `MemoryController`:
  - `GET /api/memory/status/embedding`
  - `PUT /api/memory/config/embedding`
  - `POST /api/memory/test/embedding`
- Updated `EmbeddingStatus` in `@kalio/types` to include `'mock'` as a valid provider
- Created `EmbeddingsPanel.tsx` — settings tab with preset buttons (OpenAI, CometAPI, Ollama), form for base URL / model / dimensions / API key, test button, save button

### New feature: Web Search tool (Perplexity)
- Created `SearchModule` at `apps/kalio-api/src/modules/search/`
  - `WebSearchService` — calls Perplexity direct (`sonar` model) or via OpenRouter (`perplexity/sonar`)
  - Reads config from `app_settings` first, falls back to `PERPLEXITY_API_KEY` env var
  - `SearchController`: `GET /api/search/config`, `PUT /api/search/config`, `POST /api/search/test`
- Created `WebSearchTool` in `ToolModule/tools/` — `@Tool` decorated, `requiresConfirmation: false`
- Registered in `ToolModule` + `ToolRegistryService`
- Added `PERPLEXITY_API_KEY` and `PERPLEXITY_PROVIDER` to `env.schema.ts` (optional)
- Created `WebSearchPanel.tsx` — settings tab with provider selector (Perplexity/OpenRouter), API key input, test status, save button

### Settings registry
- `registry.tsx` now has 6 tabs: LLM Providers, Embeddings, Web Search, MCP Servers, Personas, Allowed Paths

## Files touched
- `apps/kalio-api/src/database/schema.ts`
- `apps/kalio-api/src/database/database.module.ts`
- `apps/kalio-api/src/database/app-settings.service.ts` (NEW)
- `apps/kalio-api/src/database/migrations/0001_app_settings.sql` (NEW)
- `apps/kalio-api/src/database/migrations/meta/_journal.json`
- `apps/kalio-api/src/config/env.schema.ts`
- `apps/kalio-api/src/app.module.ts`
- `apps/kalio-api/src/modules/memory/embedding.service.ts`
- `apps/kalio-api/src/modules/memory/memory.service.ts`
- `apps/kalio-api/src/modules/memory/memory.controller.ts`
- `apps/kalio-api/src/modules/search/web-search.service.ts` (NEW)
- `apps/kalio-api/src/modules/search/search.controller.ts` (NEW)
- `apps/kalio-api/src/modules/search/search.module.ts` (NEW)
- `apps/kalio-api/src/modules/tool/tools/web-search.tool.ts` (NEW)
- `apps/kalio-api/src/modules/tool/tool.module.ts`
- `apps/kalio-api/src/modules/tool/tool-registry.service.ts`
- `packages/@kalio/types/src/index.ts`
- `apps/kalio-web/src/features/settings/EmbeddingsPanel.tsx` (NEW)
- `apps/kalio-web/src/features/settings/WebSearchPanel.tsx` (NEW)
- `apps/kalio-web/src/features/settings/registry.tsx`

## Test results
- 429 unit tests pass (51 test files), typecheck clean on both API and web

## Decisions made
- `AppSettingsService` lives in `DatabaseModule` (global), so all modules can inject it without extra module imports
- `SearchModule` is a separate NestJS module (not part of `ToolModule`) to keep concerns separate; `ToolModule` imports `SearchModule`
- `EmbeddingService` is still manually instantiated inside `MemoryService` (DI pattern not changed); `MemoryService.onModuleInit()` delegates to `EmbeddingService.onModuleInit()` to load persisted config
- Config stored in `app_settings` always takes precedence over env vars for embedding and search
- Web search tool does NOT expose the API key to the agent (reads from config service) — security by design
- Perplexity `sonar` model used for direct, `perplexity/sonar` via OpenRouter

## Open questions / Next steps
- Add E2E tests for the new settings tabs (ac-20-embeddings-panel, ac-21-web-search-panel)
- Consider adding rate limiting / caching to `web_search` tool to avoid excessive API charges
- Consider exposing `web_search` results with inline citations in the chat UI
