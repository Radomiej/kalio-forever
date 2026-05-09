# MCP Policy UI — Complete

**Date**: 2026-04-30  
**Status**: Done ✅

## What was done

Completed the per-persona MCP access policy feature end-to-end:

### Backend (already done in prior session)
- `MCPPolicy` type (`allow_all` | `deny_all` | `allow_list`) in `@kalio/types`
- `mcpPolicy` column in `personas` table + migration `0005_persona_mcp_policy.sql`
- `persona.service.ts` returns `mcpPolicy` in `mapRow()` and `getSessionConfig()`
- `chat.service.ts` `filterTools()` applies mcpPolicy to MCP tools

### Frontend (completed this session)
- **`PersonaToolPicker.tsx`**: Full rewrite to support MCP section
  - Imports `MCPPolicy` from `@kalio/types`
  - Props updated: `mcpPolicy: MCPPolicy`, `onChange: (tools: string[], mcpPolicy: MCPPolicy) => void`
  - Separates native tools (grouped by prefix) from MCP tools
  - MCP section with 3 radio buttons: Allow all / Deny all / Allow list
  - When `allow_list`: shows checkboxes per MCP tool
  - When `allow_all` / `deny_all`: shows explanatory text
  - Counter in header shows native-only tool count
  - `setPolicy()` strips `mcp_*` entries from skills when switching away from allow_list

- **`PersonaToolBadges.tsx`** (in same file): Updated signature
  - Now accepts `mcpPolicy?: MCPPolicy`
  - Filters native tools and MCP tools separately
  - Shows `MCP:all` or `MCP:{count}` badge when policy allows MCP

- **`PersonaPanel.tsx`**:
  - `PersonaForm`: adds `mcpPolicy` state, passes to picker, includes in `onSave()`
  - `PersonaRow`: adds `mcpPolicy` state (init from `persona.mcpPolicy`), wires picker, includes in `onUpdate()`, resets in `cancel()`
  - `PersonaToolBadges` calls updated to pass `mcpPolicy`

### Test fixes
- `tool.controller.spec.ts`: constructor call updated to pass `null` for optional MCPService
- `kv-store.service.spec.ts`: inline `CREATE TABLE personas` DDL updated to include `mcp_policy` column
- `SessionPanel.test.tsx`: mock persona fixture updated with `mcpPolicy: 'allow_all'`

## Files touched
- `apps/kalio-web/src/features/persona/PersonaToolPicker.tsx`
- `apps/kalio-web/src/features/persona/PersonaPanel.tsx`
- `apps/kalio-web/src/features/sessions/SessionPanel.test.tsx`
- `apps/kalio-api/src/modules/tool/tool.controller.spec.ts`
- `apps/kalio-api/src/modules/tool/kv-store.service.spec.ts`

## Verification
- Backend typecheck: ✅ 0 errors
- Frontend typecheck: ✅ 0 errors
- Backend tests: ✅ 45 test files, 390 tests passing (exit 0)
