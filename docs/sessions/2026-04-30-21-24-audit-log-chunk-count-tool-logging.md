# Audit Log: chunkCount, tool_call/tool_result logging, Clear All

**Date**: 2026-04-30 21:24  
**Outcome**: Complete — 166 tests pass, 0 typecheck errors

---

## What was done

### Bug fix: tool_call / tool_result never logged
`tool_call` and `tool_result` audit entries were never written despite the types existing. Fixed by adding two `this.audit.log()` calls in `ChatService.handleTurn()` inside the tool dispatch loop.

### Feature: chunkCount live tracking (500ms throttle)
Instead of inserting the `llm_response` row after the stream finishes, we now:
1. Pre-insert `llm_response` with `chunkCount: 0` before the `for await` loop
2. Increment a local counter per chunk; fire-and-forget `audit.update()` every 500ms
3. Final `audit.update()` after the loop with the real `chunkCount`, `durationMs`, and `data`

### Schema change
Added `chunk_count INTEGER` column to `audit_log` table.  
Migration `0004_audit_chunk_count.sql` DELETEs all existing rows (they were useless without chunkCount) then ALTERs the table.

### Clear All endpoint + button
- `DELETE /api/audit-log?confirm=true` truncates the table
- "Clear" button (Trash2 icon) added to the Observability page toolbar with a `window.confirm` guard

### chunkCount display
`llm_response` entries in ObservabilityPage now show a blue badge like "127c".

---

## Files touched

| File | Change |
|---|---|
| `packages/@kalio/types/src/index.ts` | `AuditLogEntry.chunkCount: number \| null` |
| `apps/kalio-api/src/database/schema.ts` | `auditLog.chunkCount: integer` |
| `apps/kalio-api/src/database/migrations/0004_audit_chunk_count.sql` | New migration |
| `apps/kalio-api/src/database/migrations/meta/_journal.json` | Entry for migration 0004 |
| `apps/kalio-api/src/modules/chat/audit.service.ts` | `log()` returns `string` (id), new `update()` method |
| `apps/kalio-api/src/modules/chat/chat.service.ts` | Pre-insert + 500ms live updates + tool_call/tool_result logging |
| `apps/kalio-api/src/modules/chat/audit-log.controller.ts` | `DELETE /api/audit-log?confirm=true` |
| `apps/kalio-web/src/features/observability/ObservabilityPage.tsx` | Clear All button + chunkCount badge |
| `apps/kalio-api/src/modules/chat/__tests__/chat.service.spec.ts` | Added `update` mock + 2 new tests |
| `apps/kalio-api/src/modules/chat/__tests__/audit.service.spec.ts` | Updated `swallows db errors` test |
| `apps/kalio-api/src/modules/chat/audit-log.controller.spec.ts` | Added `chunk_count` to CREATE TABLE + `clear()` tests |
| `apps/kalio-api/src/modules/chat/__tests__/agent-loop-limits.spec.ts` | Added `update` mock |
| `apps/kalio-api/src/modules/chat/__tests__/chat-max-iterations.spec.ts` | Added `update` mock |
| `apps/kalio-api/src/modules/chat/__tests__/chat.service.event-ordering.spec.ts` | Added `update` mock |
| `apps/kalio-api/src/modules/chat/__tests__/issues-verification.spec.ts` | Added `update` mock |

---

## Architecture decisions
- `log()` returns the inserted id even if the DB insert failed — the caller can safely call `update()` and it will be a no-op (no row to update = 0 rows affected, no error).
- Live updates are fire-and-forget (`void this.audit.update(...)`) — no streaming latency impact.
- `confirm=true` query param on DELETE is a minimal safety gate (this is a local dev tool).
- DB truncation on migration: existing `llm_response` rows without chunkCount are worthless noise and the migration is a clean break.
