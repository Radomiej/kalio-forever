# 2026-04-30-21-55 — Review fixes + MCP injection bug

## What was done

### Root cause found: Migration journal missing 0005
`_journal.json` didn't have an entry for `0005_persona_mcp_policy`. Drizzle's migrator only runs migrations listed in the journal, so the `mcp_policy` column was never added to the DB. All persona API calls would fail silently (migration error is caught as non-fatal). Fixed by adding the entry and clearing `data/kalio.db`.

### Root cause found: MCPService injection broken (production bug)
`ToolDispatchService` used `@Optional() private readonly mcpService: MCPService | null`. TypeScript emits `Object` as `design:paramtypes` for union types (`MCPService | null`), so NestJS's DI couldn't match the `MCPService` provider token. The MCPService was always `null` → MCP tools were never visible/callable. Fixed by adding `@Inject(MCPService)` alongside `@Optional()`.

### Fixes applied (all TDD — failing test first)

| Fix | File | Change |
|-----|------|--------|
| #3: chat:context systemPrompt | `chat.service.ts` | Changed `systemPrompt` → `effectiveSystemPrompt` in `trackingEmit('chat:context', ...)` |
| #2: MCP requiresConfirmation | `tool-dispatch.service.ts` | Added HITL check before `callTool()` using `getAllTools().find()` |
| Injection: @Inject(MCPService) | `tool-dispatch.service.ts` | Added `@Inject(MCPService)` to ensure DI resolves correctly for union type |
| MCP pagination | `mcp.service.ts` | `discoverTools()` now follows `nextCursor` in a loop |
| #5: clearLogs errors | `ObservabilityPage.tsx` | Added `clearError` state; checks HTTP status; shows inline error message |
| #8: persona seed prompt | `persona.service.ts` | Removed redundant `call list_tools` instruction |

### Tests added
- `chat.service.spec.ts`: `chat:context emits effectiveSystemPrompt that includes tools section`
- `tool-dispatch.service.spec.ts`: 3 new tests in "dispatch — MCP tool routing" describe block

## Results
- 903/903 backend tests pass (80 test files)
- Both apps typecheck clean (exit code 0)

## Files touched
- `apps/kalio-api/src/database/migrations/meta/_journal.json` — added 0005 entry
- `apps/kalio-api/src/modules/chat/chat.service.ts` — effectiveSystemPrompt in chat:context
- `apps/kalio-api/src/modules/chat/tool-dispatch.service.ts` — @Inject(MCPService), MCP HITL check
- `apps/kalio-api/src/modules/mcp/mcp.service.ts` — cursor pagination in discoverTools()
- `apps/kalio-api/src/modules/persona/persona.service.ts` — removed list_tools from seed prompt
- `apps/kalio-web/src/features/observability/ObservabilityPage.tsx` — clearError state/display
- `apps/kalio-api/src/modules/chat/__tests__/chat.service.spec.ts` — new effectiveSystemPrompt test
- `apps/kalio-api/src/modules/chat/__tests__/tool-dispatch.service.spec.ts` — new MCP dispatch tests

## Open questions / next steps
- Docker MCP Gateway with 110 tools — pagination fix should now help discovery
- Consider setting `requiresConfirmation: true` on destructive MCP tools (currently always false)
