# 2026-04-30 11:15 — Embedding + Memory E2E Testing

## What Was Done

Tested the full embedding + memory pipeline end-to-end using Playwright MCP browser automation.

### Goals
1. ✅ Verify dev server starts with `start-dev.ps1`
2. ✅ Add CometAPI as embedding provider
3. ✅ Test memory ingest + search
4. ✅ Test agent with memory via chat

---

## Bugs Fixed During Session

### Bug 1: Missing `embedding_credentials` table
- **Symptom**: `POST /api/memory/embedding-credentials` → `SqliteError: no such table: embedding_credentials`
- **Root Cause Chain**:
  1. `0002_embedding_credentials.sql` existed but was missing from `_journal.json`
  2. `__drizzle_migrations` only had 0000's hash; 0001 was untracked
  3. Drizzle tried to re-run `0001_app_settings.sql` → "table already exists" → migration aborted
  4. `DrizzleService` swallowed the error with `catch { logger.warn() }` — 0002 never ran
- **Fix**: One-off script (`fix-migrations.mjs`) applied 0002 SQL directly and inserted 0001+0002 SHA256 hashes into `__drizzle_migrations`
- **Files Modified**: `src/database/migrations/meta/_journal.json` (added 0002 entry)

### Bug 2: `embedding_model` column missing in existing vector store
- **Symptom**: `SqliteError: no such column: embedding_model` on memory ingest
- **Root Cause**: `data/memory/default.db` was created before `embedding_model` was added to DDL; `CREATE TABLE IF NOT EXISTS` skips changes for existing tables
- **Fix**: Added `ALTER TABLE memories ADD COLUMN embedding_model TEXT NOT NULL DEFAULT ''` in try-catch inside `VectorStoreService.initSchema()`
- **Files Modified**: `apps/kalio-api/src/modules/memory/vector-store.service.ts`

---

## E2E Test Results

| Step | Result |
|------|--------|
| Dev server starts | ✅ API :3016, Web :5188 |
| CometAPI credential added | ✅ name="CometAPI", model=text-embedding-3-small, base=https://api.cometapi.com/v1 |
| Connection probe (before save) | ✅ "OK!" |
| Connection test (after save) | ✅ "OK!" |
| Credential activated as default | ✅ Active badge shown |
| Memory ingest | ✅ "Ingested 1 chunks" |
| Memory search (UI) | ✅ Result returned, score=2%, correct content |
| Agent memory_search via chat | ✅ Agent called `memory_search`, found result (score=0.47), reported CometAPI + text-embedding-3-small |

---

## Files Touched

- `apps/kalio-api/src/database/migrations/meta/_journal.json` — added 0002 entry
- `apps/kalio-api/src/modules/memory/vector-store.service.ts` — ALTER TABLE migration on init
- `apps/kalio-api/data/kalio.db` (runtime) — patched `__drizzle_migrations`, `embedding_credentials` table created
- `apps/kalio-api/data/memory/default.db` (runtime) — column migrated, 1 memory entry ingested

---

## Key Decisions

- The `ALTER TABLE` approach in `initSchema()` is safe: it runs on every cold start of a VectorStoreService instance, but SQLite's error on "column already exists" is caught and ignored — no performance or correctness impact
- Drizzle migration tracking relies on SHA256 hashes matching exactly — any out-of-band schema changes need the hash inserted manually into `__drizzle_migrations`

---

## Open Questions / Next Steps

- Consider adding a guard in `DrizzleService` that doesn't swallow migration errors (currently `catch { logger.warn() }` hides all migration failures)
- Consider auditing all `_journal.json` entries match `__drizzle_migrations` on startup
- Agent used `personaId` trial-and-error (tried "kalio", "assistant", "system", then "default") — could improve UX by telling the agent which personaId to use in the system prompt
