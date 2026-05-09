# 2026-04-30 Embedding Credentials Test Coverage

## What was done
Added comprehensive test coverage for the new embedding provider multi-credential system.

## Files created
- `apps/kalio-api/src/modules/memory/embedding-credentials.service.spec.ts`
  - 18 unit tests: findAll, create, remove, setActive/clearActive/getActiveId, getActiveConfig, getConfigById
  - Edge cases: remove-clears-active, stale-active-pointer, setActive-throws-NotFoundException, double-setActive replaces previous
- `apps/kalio-api/src/modules/memory/embedding.service.spec.ts`
  - 30 unit tests covering MockEmbeddingProvider, OllamaEmbeddingProvider, OpenAICompatibleEmbeddingProvider, EmbeddingService
  - Scenarios: mock/env/db source selection, DB overrides env, clearActive falls back to env, LLM_* env var fallback, "mock" literal env treated as missing, ollama URL detection, onModuleInit, getProvider before init, getModelName
- `apps/kalio-api/src/modules/memory/memory.controller.embedding.spec.ts`
  - 23 integration tests for all HTTP routes: list, create, setActive, clearActive, remove, getStatus, test
  - Edge cases: NotFoundException on bad id, test-does-not-change-active, remove-non-active-preserves-active, full lifecycle
- `apps/e2e/tests/ac-21-embedding-credentials.spec.ts`
  - 14 Playwright E2E tests: panel renders, mock warning, add form, provider presets, create via UI, activate, remove with confirmation, switch active, full lifecycle, API contract tests

## Bug found and fixed
`embedding.service.ts` was using `credentialId`/`credentialName` as property names in `getStatus()` but `@kalio/types`' `EmbeddingStatus` interface defines `activeCredentialId`/`activeCredentialName`. Fixed the property names.

## Results
- API test suite: 500/500 tests pass (54 test files)
- Typecheck: exit 0 on both api and web
- New tests: 71 unit+integration pass
- E2E: written and ready (requires running server)
