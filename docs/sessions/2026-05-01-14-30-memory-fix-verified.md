# Session: Memory Fix Verification

**Date**: 2026-05-01 14:30  
**Topic**: Memory tool personaId auto-resolution — verification & end-to-end test

---

## What Was Done

This session continued from the previous one (2026-04-30-14-30) that removed `personaId` from memory tool schemas and added auto-resolution from session.

### Verification performed

1. **Tool schema via running server** (`GET /api/tools`):  
   Confirmed `memory_ingest` schema shows:
   - `required: ["text"]` — only `text` required
   - NO `personaId` field in `properties` (not even optional)
   - Description: "The persona is resolved automatically from the current session — do not guess it."

2. **DB lookup test** (Node.js direct SQLite):  
   Confirmed `resolvePersonaId()` logic works:
   - Session `SJ6Xb-s-8FClkI7pavHtl` → `ra-apps`
   - Session `BC3-Dqe-LCG6jU9dqURWL` → `default`
   - Session `"user"` → NOT FOUND (rejects gracefully)

3. **Memory ingest + isolation test**:  
   Ingested one entry to `ra-apps` via REST API:
   - `ra-apps.db` grew from 64KB → 6MB (entry stored correctly)
   - `user.db` stayed at 6MB (no new data written — **isolation confirmed**)
   - `ra-apps` entry appeared in `GET /api/memory/ra-apps` response

---

## Files Touched (this session — previous sessions did the actual changes)

No code was modified in this session. This was verification only.

---

## State of Memory DBs

| File | Size | Entries | Status |
|------|------|---------|--------|
| `default.db` | 6.1MB | 1 | Correct persona DB |
| `ra-apps.db` | 6.1MB | 2 | Correct persona DB (grew during test) |
| `user.db` | 6.1MB | 2 | **Legacy orphan** — from pre-fix hallucinations |
| `{sessionId}.db` × ~368 | 64KB each | (minimal) | **Orphans** — LLM was using session IDs as personaIds |

### About the 371 DB files

Before the fix, the LLM was free to provide `personaId` in the tool call. It hallucinated various values:
- `"user"` — common hallucination → 6MB orphan DB
- Session IDs (nanoid format) — LLM confused sessionId with personaId → ~368 64KB files

These orphaned files are harmless but waste disk space. A one-time cleanup script could delete all `.db` files in `data/memory/` except `default.db` and `ra-apps.db` (and any future persona IDs).

---

## Changes from Previous Session (summary)

### `apps/kalio-api/src/modules/tool/tools/memory.tools.ts`
- Removed `personaId` from all three tool schemas (`memory_ingest`, `memory_search`, `memory_ingest_conversation`)
- Added `resolvePersonaId(drizzle, sessionId)` helper using sync Drizzle query
- `DrizzleService` injected into all three tool classes
- Unit tests: 19/19 passing

### `packages/@kalio/types/src/index.ts`
- Removed 5 dead socket events: `memory:ingest`, `memory:ingestConversation`, `memory:search`, `memory:ingested`, `memory:results`
- Removed 3 dead interfaces: `MemoryIngestRequest`, `MemoryConversationIngestRequest`, `MemorySearchRequest`

### `apps/kalio-web/src/features/memory/MemoryPage.tsx`
- Added "All" browse button (`data-testid="memory-browse-btn"`)
- Added browse mode state showing all entries without a search query
- Persona switch resets browse results

---

## Open Questions / Next Steps

1. **Orphaned DB cleanup**: ~369 files using session IDs as personaIds + `user.db`. Consider a maintenance script:
   ```ts
   // Only keep {personaId}.db files where personaId exists in personas table
   ```

2. **Memory UI polish**: The 2 entries in `ra-apps.db` are duplicates from testing. Not a bug — just test data.

3. **E2E test coverage**: There is no Playwright spec for memory ingestion path (agent calling `memory_ingest` tool and data appearing in Memory UI). Would be useful as `ac-XX-memory-ingest.spec.ts`.
