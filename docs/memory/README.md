# Memory (Agent Memory)

This feature stores long-term, persona-scoped memory entries and makes them searchable from the UI and from tools.

## What gets stored

- `memory_ingest` stores plain text chunks with optional string metadata.
- `memory_ingest_conversation` stores an array of conversation messages (`role` + `content`) as grouped memory blocks.
- Each stored chunk includes:
  - persisted content text
  - metadata map
  - persona ownership
  - creation timestamp
  - scoreable embedding/index fields used by search

## Persona scoping rules

- Manual memory API calls in Memory page require a selected persona ID and pass that `personaId` directly.
- Tool calls (`memory_ingest`, `memory_search`, `memory_ingest_conversation`) do not rely on client-provided `personaId`.
- Tool calls resolve persona from the chat session (`sessionId`) inside the tool executor:
  - reads `sessions.personaId` in DB
  - executes tool logic using that persona
  - fails if session cannot be resolved.

This keeps memory separate between personas.

## API paths used

- `GET /api/personas` - populates the persona dropdown in Memory page.
- `GET /api/memory/{personaId}` - fetch all memory chunks for a persona (used for stats and All).
- `GET /api/memory/search` - query memory (`query`, `personaId`, `mode`, `limit`).
- `POST /api/memory/ingest` - add raw text memory.
- `POST /api/memory/ingest-conversation` - add conversation memory blocks.
- `DELETE /api/memory/{personaId}` - delete all memory for a persona.
- `DELETE /api/memory/{personaId}/{id}` - delete one memory chunk.
- Tool call names: `memory_ingest`, `memory_search`, `memory_ingest_conversation`.

## UI path (first user flow)

1. Open **Mind -> Memory**.
2. Pick a persona.
3. Use:
   - **Search** for exact query with `hybrid` / `vector` / `fts`.
   - **All** to browse all chunks currently saved for that persona.
   - **Add** to open ingest form and save new memory.
   - Per-row **Delete** for individual chunks.
4. Memory status bar shows:
   - entry count
   - size estimate
   - selected persona
   - simple freshness stamp (`Sync: <reason> @ <time>`), updated on load/search/browse/ingest/delete.

## Limitations (Sprint A)

- No WebSocket/push refresh: the UI is pull-based and updates freshness after explicit actions only.
- Freshness is UI-only, based on successful local fetch/operations, not a strict backend "last commit" timestamp.
- Tool confirmations still rely on existing confirmation plumbing (no new auth/RBAC changes).
- Search is intentionally minimal for user onboarding; deeper diagnostics stay backend-focused.

## Troubleshooting

- If the persona dropdown is empty, create a persona first in **Mind -> Personas**.
- If Search returns stale results, use **All** to force a fresh pull and verify `Sync` stamp updates.
- If Add fails, check backend embedding config and whether `/api/memory/ingest` returns an error.
- If Delete appears to do nothing, confirm the persona and row are selected and inspect API logs for `DELETE /api/memory/{personaId}/{id}`.
