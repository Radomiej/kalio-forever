# Session: UI/UX Improvements Complete

**Date**: 2026-04-30 ~14:30  
**Status**: All 8 tasks done. TypeScript clean. 504/504 unit tests pass.

---

## What was done

### A1 — Conversations sorted newest-first
- `SessionPanel.tsx`: Added `.slice().sort((a, b) => b.updatedAt - a.updatedAt)` to `visibleSessions`

### A2 — Personas removed from Settings panel
- `settings/registry.tsx`: Removed `PersonasPanel` import, `Users` icon, and the personas entry from `SETTINGS_BLOCKS`

### A3 — Tool grouping + requiresConfirmation toggle in ToolPanel
- `features/tools/ToolPanel.tsx`: Full rewrite
  - `TOOL_GROUPS` array with 9 categories (Agent, VFS, Filesystem, KV, Terminal, RA-Apps, Memory, Search, Web)
  - `groupToolsByPrefix()` pure grouping function (exported, testable)
  - `ToolPanel` now only loads `/api/tools` (removed MCP from the list)
  - `ToolRow` has Shield/ShieldOff button that calls `PATCH /api/tools/:name`
  - Optimistic update with rollback on failure

### A4 — Canvas scoped to chat; closes on nav; conditional toggle; subagent click opens it
- `store/agentStore.ts`: Added `canvasOpen`, `setCanvasOpen`, `toggleCanvas`
- `features/chat/CanvasPanel.tsx`: Removed props, reads from `agentStore`; toggle only shown when streaming/active
- `features/chat/ToolCallBubble.tsx`: `run_subagent` history bubble gets ExternalLink button → `setCanvasOpen(true)`
- `App.tsx`: Removed local `canvasOpen` state; `<CanvasPanel />` moved inside talk section; `useEffect` closes canvas on navigation away from talk

### B2 — Loops removed entirely
- Deleted: `apps/kalio-api/src/modules/agent-loop/` (3 files)
- Deleted: `apps/kalio-web/src/features/agentLoop/AgentLoopPanel.tsx`
- `app.module.ts`: Removed `AgentLoopModule` import and from imports array
- `database/schema.ts`: Removed `agentLoops`, `agentTasks`, `agentIterations` tables and their type helpers; added `toolOverrides` table
- `packages/@kalio/types/src/index.ts`: Removed all AgentLoop types and all `agentLoop:*` socket events
- Migration `0003_loops_remove_tool_overrides.sql`: Drops 3 loop tables, creates `tool_overrides`
- `meta/_journal.json`: Added idx 3 entry

### C1 — Backend PATCH /tools/:name endpoint
- `tool-registry.service.ts`: Added `setOverride(toolName, requiresConfirmation): boolean`
- `tool.controller.ts`: Full rewrite — added `DrizzleService` injection, `OnModuleInit` (loads DB overrides on startup), `PATCH :name` (upserts override, returns updated ToolMeta)

---

## Files touched (20 total)

| File | Change |
|------|--------|
| `apps/kalio-web/src/store/agentStore.ts` | Added canvas state |
| `apps/kalio-web/src/features/sessions/SessionPanel.tsx` | Sort newest-first |
| `apps/kalio-web/src/features/settings/registry.tsx` | Remove personas tab |
| `apps/kalio-web/src/features/tools/ToolPanel.tsx` | Full rewrite with grouping + toggle |
| `apps/kalio-web/src/features/chat/CanvasPanel.tsx` | Read from store, conditional toggle |
| `apps/kalio-web/src/features/chat/ToolCallBubble.tsx` | Subagent opens canvas |
| `apps/kalio-web/src/App.tsx` | Remove loops tab, canvas inside talk section |
| `apps/kalio-api/src/app.module.ts` | Remove AgentLoopModule |
| `apps/kalio-api/src/database/schema.ts` | Remove loop tables, add toolOverrides |
| `apps/kalio-api/src/database/migrations/0003_loops_remove_tool_overrides.sql` | Created |
| `apps/kalio-api/src/database/migrations/meta/_journal.json` | Added entry |
| `apps/kalio-api/src/modules/tool/tool-registry.service.ts` | Added setOverride() |
| `apps/kalio-api/src/modules/tool/tool.controller.ts` | Added PATCH, OnModuleInit |
| `packages/@kalio/types/src/index.ts` | Removed AgentLoop types + events |
| *(deleted)* `apps/kalio-api/src/modules/agent-loop/` (3 files) | Gone |
| *(deleted)* `apps/kalio-web/src/features/agentLoop/AgentLoopPanel.tsx` | Gone |

---

## Open questions / Next steps

- E2E Playwright tests not run — may need updates if any spec referenced Loops tab or canvas toggle
- The `PATCH /api/tools/:name` requires `requiresConfirmation` in body to be boolean; no input validation (Zod/class-validator) added — could be added if needed
- Pre-existing failing spec: `raapp.service.spec.ts` (7 failures, known, unrelated to this session)
