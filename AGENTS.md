# AGENTS.md — Kalio v2 (NestJS Monorepo)

> Cross-tool baseline for GitHub Copilot, Cursor, Claude, and all AI coding agents.
> Read this file before touching any code. Every rule here is a hard constraint.

---

## Project Summary

Kalio v2 is a **modular NestJS 11 monorepo** — a full rewrite of Kalio v1.
The core product is an AI chat interface where a "fat" backend orchestrates LLM streaming,
tool execution, HITL gates, VFS file I/O, persona management, and MCP dynamic tool discovery.
The frontend is intentionally thin: it renders state, emits events, never calls LLM directly.

### Workspace Layout

```
apps/
  kalio-api/          ← NestJS fat backend          (port 3016)
  kalio-web/          ← React thin frontend          (port 5188)
  e2e/                ← Playwright E2E tests
packages/
  @kalio/types        ← ONLY source of truth for all contracts
  @kalio/sdk          ← Socket.IO client SDK (typed, wraps eventBus)
```

### Key Technologies

| Layer | Stack |
|---|---|
| Monorepo | Turborepo 2.4 + pnpm 9 workspaces |
| Backend | NestJS 11, TypeScript 5.8 strict, Socket.IO 4.8 |
| ORM | Drizzle ORM + better-sqlite3 |
| Frontend | React 19, Vite 6, Zustand 5, TailwindCSS 4, daisyUI 5 |
| Tests | Vitest (unit/integration) + Playwright (E2E) |

---

## Build Commands

```powershell
# Install dependencies (root)
pnpm install

# Build all packages
pnpm turbo run build

# Type-check all packages
pnpm turbo run typecheck

# Lint all packages
pnpm turbo run lint

# Run all unit tests
pnpm turbo run test

# Run E2E tests
pnpm turbo run test:e2e

# Start dev servers (both API + web, hot-reload)
.\start-dev.ps1

# Drizzle migrations (run once on first start)
pnpm --filter kalio-api drizzle-kit migrate
```

---

## NestJS Module Map

| Module | Path | Responsibility |
|---|---|---|
| `ChatModule` | `src/modules/chat/` | Sessions, message history, LLM streaming gateway |
| `PersonaModule` | `src/modules/persona/` | Persona CRUD, system prompt, model, skills, KV store |
| `ToolModule` | `src/modules/tool/` | Registry, dispatch, native tools, HITL gate |
| `VFSModule` | `src/modules/vfs/` | Filesystem per conversationId, path traversal guard |
| `MCPModule` | `src/modules/mcp/` | Client manager, dynamic tool discovery, watchdog |
| `RAAppModule` | `src/modules/raapp/` | DSL executor, sandbox (`vm.runInNewContext`), render |
| `CredentialsModule` | `src/modules/credentials/` | API key storage (SQLite, never exposed in API responses) |
| `LLMModule` | `src/modules/llm/` | Provider routing (OpenAI-compatible / Mock) |

---

## Allowed and Restricted File Areas

### Agent MAY touch freely
- `apps/kalio-api/src/modules/[module-name]/` — all module files
- `apps/kalio-web/src/` — all frontend files
- `apps/e2e/tests/` — E2E tests
- `packages/@kalio/sdk/src/` — SDK wrapper

### Agent MUST NOT touch without human sign-off
| File | Reason |
|---|---|
| `packages/@kalio/types/**` | Contract changes risk drift — require PR review |
| `apps/kalio-api/src/main.ts` | Bootstrap — structural changes only |
| `turbo.json` | Pipeline config — affects all CI |
| `pnpm-workspace.yaml` | Workspace roots |
| `drizzle.config.ts` | Schema generation source |

---

## Hard Architecture Rules

These are enforced by ESLint (`import/no-restricted-paths`) and blocked in CI. Breaking them is a stop condition.

| Rule | Description |
|---|---|
| ❌ Zero cross-module imports | Modules may NOT import from each other. Only `@kalio/types` crosses module boundaries. |
| ❌ No `any` in TypeScript | Strict mode is non-negotiable. Use `unknown` + narrowing or explicit types. |
| ❌ No empty catch | `.catch(() => {})` is forbidden. Log the error AND rethrow or handle explicitly. |
| ❌ No LLM calls from FE | All LLM traffic goes through the Socket.IO gateway on the backend. |
| ❌ No direct filesystem access outside VFSModule | All file I/O must go through `VFSService`. |
| ❌ No type duplication | Every shared type lives in `@kalio/types/src/index.ts`. Zero copy-paste. |
| ✅ Tool = separate `@Injectable()` class | Each tool must have its own class with `@Tool()` decorator. |
| ✅ Destructive tools need `requiresConfirmation: true` | VFS delete, terminal exec, etc. must trigger HITL dialog. |
| ✅ Every error logged + handled | No silent failures. Always log with context. |
| ✅ New env vars → `.env.example` + `env.schema.ts` | Joi schema is the only source of truth for env contract. |

### File Size Limits

| File Type | Soft Limit | Hard Limit |
|---|---|---|
| Controller / Gateway | 150 lines | 250 lines |
| Service | 300 lines | 400 lines |
| Module | 80 lines | 120 lines |
| Test file | 400 lines | 600 lines |
| React Component | 200 lines | 350 lines |

When approaching the soft limit: stop, refactor, extract. Never exceed the hard limit.

---

## HITL (Human-in-the-Loop) Gate

Tools marked `@Tool({ requiresConfirmation: true })` trigger the HITL flow:

1. Backend emits `tool:confirmation_required` via Socket.IO with `{ requestId, toolName, args }`
2. Frontend shows `ConfirmationDialog` — user clicks Confirm or Cancel
3. Frontend emits `tool:confirm` or `tool:cancel` with `{ requestId, sessionId }`
4. Backend resolves the pending promise → tool executes (confirm) or `TOOL_CANCELLED` (cancel)
5. 30-second timeout auto-cancels if no user response

**All tools that write, delete, or execute system commands MUST have `requiresConfirmation: true`.**

---

## TDD Workflow (Mandatory for all new features)

```
1. Read §7 of kalio-v2-mvp-spec.md — identify the AC you're implementing
2. Write the test FIRST (unit in Vitest or E2E stub in Playwright)
3. Run tests → RED ❌
4. Implement the minimum code to pass
5. Run tests → GREEN ✅
6. Refactor if needed (no new test failures)
7. Update AC-Status Tracker in kalio-v2-mvp-spec.md §11
```

**After 2 consecutive failures on the same AC: stop and report to human. Do NOT silently change the test.**

---

## Stop Conditions (Pause and Wait for Human)

| Trigger | Why |
|---|---|
| Need to import from another module (not `@kalio/types`) | Module boundary violation |
| Need to change types in `packages/@kalio/types` | Contract change — risk of drift |
| Need a new env variable | Schema change → update §4 + `.env.example` + `env.schema.ts` |
| File would exceed hard line limit | Refactor decision needed |
| 2+ failures on same AC | Spec ambiguity |
| A v1 pattern seems necessary | v2 architecture has a solution — ask first |
| Destructive operation without HITL gate | Security boundary |

---

## Skill Routing Table

| Task domain | Approach |
|---|---|
| Add a new native tool | Create `apps/kalio-api/src/modules/tool/tools/[name].tool.ts`, add to `ToolModule` providers, add to `ToolDispatchService` |
| Add a new REST endpoint | Add method to existing controller, update Swagger if needed, add test |
| Add a new Socket.IO event | Add to `SocketEvents` in `@kalio/types` first, then handler in `ChatGateway`, then SDK wrapper in `@kalio/sdk` |
| Add a Zustand store | Create in `apps/kalio-web/src/store/`, never hold derived state that's available in server response |
| Add a React feature component | Create in `apps/kalio-web/src/features/[domain]/`, use `data-testid` on all interactive elements |
| Drizzle schema change | Edit `schema.ts`, run `drizzle-kit generate`, run `drizzle-kit migrate`, update types if needed |
| MCP tool integration | Add via `MCPService.addServer()`, tools auto-discovered and registered in `ToolRegistryService` |

---

## Environment Variables Reference

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | No | `3016` | Backend port |
| `NODE_ENV` | No | `development` | `test` makes LLM vars optional (uses MockProvider) |
| `DATABASE_PATH` | Yes | `./data/kalio.db` | SQLite file path |
| `WORKSPACE_ROOT` | Yes | `./data/workspaces` | Root for VFS per conversation |
| `LLM_API_KEY` | Yes* | — | *Optional when `NODE_ENV=test` (default: `'mock'`) |
| `LLM_BASE_URL` | Yes* | — | *Optional when `NODE_ENV=test` |
| `LLM_MODEL` | Yes* | — | *Optional when `NODE_ENV=test` |
| `VITE_API_URL` | Yes | `http://localhost:3015` | FE → BE REST base URL |
| `VITE_WS_URL` | Yes | `http://localhost:3015` | FE → BE Socket.IO URL |

---

## Common Patterns

### NestJS Module (3-file pattern)
```
[module-name]/
  [module-name].module.ts     ← Module definition, imports, providers, exports
  [module-name].service.ts    ← Business logic
  [module-name].controller.ts ← REST endpoints (if any)
```

### Adding a tool with HITL
```typescript
// In apps/kalio-api/src/modules/tool/tools/my-tool.tool.ts
@Injectable()
export class MyTool {
  constructor(private readonly vfsService: VFSService) {}

  @Tool({
    name: 'my_tool',
    description: 'Does something destructive',
    parameters: { /* JSON Schema */ },
    requiresConfirmation: true,   // ← REQUIRED for destructive tools
  })
  async execute(args: { path: string }): Promise<ToolResult> {
    // implementation
  }
}
```

### Socket.IO event (full chain)
1. Add event to `SocketEvents` in `@kalio/types/src/index.ts`
2. Add handler in `ChatGateway` (`@SubscribeMessage('event:name')`)
3. Add wrapper method in `KalioSDK` in `@kalio/sdk/src/index.ts`
4. Use `eventBus.[method]()` in React component

### Drizzle query pattern
```typescript
// Always inject DrizzleService, never instantiate directly
constructor(private readonly db: DrizzleService) {}

async findAll() {
  return this.db.connection.select().from(personas).all();
}
```

---

## Anti-Patterns (Never Do These)

These were the root causes of v1 collapse. Do not repeat them.

| Pattern | v1 Problem | v2 Solution |
|---|---|---|
| God object / god component | `ToolRouter.ts` 1335L, `ChatInterface.tsx` 705L | Module classes + thin FE |
| Manual type sync between BE and FE | `contracts.ts` drift | Single `@kalio/types` package |
| Setter injection / global state | No DI container | NestJS `@Injectable()` DI |
| Inline Socket.IO handlers in `index.ts` | Untestable, unscalable | `@WebSocketGateway()` |
| In-memory VFS | Restart = data loss | Real filesystem + `VFSService` |
| SQLite + PostgreSQL mix | No unified adapter | Drizzle ORM with dialect abstraction |
| LLM calls from frontend | CORS, key exposure | Gateway-only LLM access |

---

## Testing Expectations

### Unit/Integration (Vitest)
- Every `Service` class: ≥80% coverage
- `VFSService.resolveSafe()`: 100% coverage (security-critical)
- `ToolRegistryService`: test that unknown tools throw `TOOL_NOT_FOUND`
- `ChatService`: test HITL pending/confirm/cancel flow
- Mock: use `MockLLMProvider` — never use real API keys in unit tests

### E2E (Playwright)
- All 15 AC from `docs/kalio-v2-mvp-spec.md §7` must have passing tests
- Test stubs are in `apps/e2e/tests/ac-XX-*.spec.ts`
- `NODE_ENV=test` in webServer config → uses `MockLLMProvider`
- Every interactive element has `data-testid` attribute for stable selectors

---

## Changelog of Key Decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-04-21 | Full rewrite (not migration) | v1 god objects impossible to incrementally fix |
| 2026-04-21 | NestJS 11 over Express 5 | DI container, modules, testability |
| 2026-04-21 | Drizzle ORM (not Prisma/TypeORM) | SQLite today → PG tomorrow, type-safe, minimal overhead |
| 2026-04-21 | Real filesystem VFS | v1 restart = data loss — unacceptable |
| 2026-04-21 | SQLite only to MVP | PostgreSQL post-MVP, Drizzle adapter ready |
| 2026-04-21 | pnpm workspaces (not npm) | Monorepo dependency deduplication |
| 2026-04-21 | `@kalio/types` as sole contract | Eliminates drift that plagued v1 |
| 2026-04-21 | Auth = post-MVP | Local-only MVP, auth after validation |
| 2026-04-21 | Forever Loop + Orchestrator = post-MVP | Core modularity more important than advanced features |
