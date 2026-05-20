# WebSearch History Persistence

## What Was Done

- Added a global SQLite-backed WebSearch history store at the search module layer.
- Persisted successful Perplexity and Perplexity-via-OpenRouter calls as query/answer/citation/model/provider records.
- Changed `web_search` responses to return `{ result, historicalSearch?, historicalSearchHint? }`.
- Added `search_historical_web_search` for direct lookup of prior web search answers.
- Registered the new tool in the tool provider catalog and dispatch registry.
- Added `WEBSEARCH_DB_PATH` as an optional env override; default resolution uses `%APPDATA%/Kalio/websearch.db` when available.

## Files Touched

- `apps/kalio-api/src/modules/search/web-search-history.store.ts`
- `apps/kalio-api/src/modules/search/web-search-history.store.spec.ts`
- `apps/kalio-api/src/modules/search/web-search.service.ts`
- `apps/kalio-api/src/modules/search/web-search.service.spec.ts`
- `apps/kalio-api/src/modules/search/search.module.ts`
- `apps/kalio-api/src/modules/tool/tools/search-historical-web-search.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/search-historical-web-search.tool.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/web-search.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/web-search.tool.spec.ts`
- `apps/kalio-api/src/modules/tool/tool.providers.ts`
- `apps/kalio-api/src/modules/tool/tool-registry.service.ts`
- `apps/kalio-api/src/modules/tool/tool-registry.service.spec.ts`
- `apps/kalio-api/src/config/env.schema.ts`

## Decisions Made

- History is application-global, not persona-scoped or session-scoped.
- WebSearch history is kept separate from long-term persona memory and `memory_search`.
- Related history is returned only when matches exist.
- The explicit fallback tool is `search_historical_web_search`; no `search_memory` alias was added.
- Matching uses local lexical scoring over recent rows instead of embeddings to keep the first implementation small and dependency-free.

## Verification

- Added failing tests first, then implemented until they passed.
- Ran focused tests:
  - `src/modules/search/web-search.service.spec.ts`
  - `src/modules/search/web-search-history.store.spec.ts`
  - `src/modules/tool/tools/web-search.tool.spec.ts`
  - `src/modules/tool/tools/search-historical-web-search.tool.spec.ts`
  - `src/modules/tool/tool-registry.service.spec.ts`
- Result: 40 tests passed across 5 files.
- Ran API typecheck. It is currently blocked by existing, unrelated `execFile` mock type errors in cli-agent specs.

## Open Questions

- Whether to add retention controls for `websearch.db` later, such as max rows or TTL.
- Whether to add FTS5 or embedding-based ranking later if lexical matching is not enough.