# Kalio-Forever — Copilot Instructions

## Required Reading

- Read `AGENTS.md` first. It is the cross-agent source of truth for repo rules.
- Treat `.github/copilot-instructions.md` as the canonical Copilot-specific file.
- Keep the root `.copilot-instructions.md` as a short compatibility shim only; do not duplicate this file there.

## Stack

- **Backend**: NestJS 11, TypeScript 5.8 strict, Drizzle ORM + SQLite, Socket.IO
- **Frontend**: React 19, Zustand, DaisyUI/Tailwind, `@kalio/sdk`
- **Monorepo**: pnpm 9 + Turborepo 2.4, Node.js runtime
- **Tests**: Vitest (unit/integration), Playwright (E2E in `apps/e2e/`)

## Commands

```
pnpm install                      # install from root
pnpm turbo run build              # build all
pnpm turbo run test               # unit tests all
pnpm turbo run typecheck          # tsc --noEmit all
pnpm audit:report                 # static audit + prioritized report
.\start-dev.ps1                   # API :3016 + web :5188
pnpm turbo run lint               # lint all
pnpm turbo run test:e2e           # Playwright E2E
```

Single-file or narrow-scope iteration:
- Backend typecheck (current package): `cd apps/kalio-api && node_modules\.bin\tsc.CMD --noEmit`
- Frontend single test: `cd apps/kalio-web && npm run test -- src/features/<feature>/<file>.spec.ts`
- E2E single spec: `cd apps/e2e && npx playwright test tests/<spec>.spec.ts`

## Layout

```
apps/kalio-api/src/
  modules/          # one folder per domain (chat, persona, vfs, tool, raapp, …)
  database/         # schema.ts + migrations/
apps/kalio-web/src/
  features/         # React feature folders
  store/            # Zustand stores
  services/         # eventBus, apiClient
packages/@kalio/
  types/src/index.ts   # ONLY source of BE↔FE contracts
  sdk/src/index.ts     # KalioSDK (Socket.IO client wrapper)
apps/e2e/tests/      # Playwright specs (ac-XX-*)
```

## Architecture

### Session is the unit of isolation
`ChatSession` (not workspace) scopes everything:
- **VFS**: `{WORKSPACE_ROOT}/sessions/{sessionId}/files/`
- **KV store**: `{WORKSPACE_ROOT}/sessions/{sessionId}/_kv.json`
- `WORKSPACE_ROOT` env var = on-disk storage root, NOT a user entity — never expose it as an API object

### Type contracts
All shared types live exclusively in `packages/@kalio/types/src/index.ts`.
- **Never duplicate types** across apps
- **Never add `workspaceId`** to session, message, or tool types — this was deliberately removed
- Import with `import type { … } from '@kalio/types'` — type-only across module boundaries
- **GUI DSL wire types** (`GuiNode`, `GuiElementNode`, `GuiBlockNode`, `GuiValue`, `GuiDslPayload`) are in `@kalio/types` — never redefine locally in FE or BE
- **Audit types** (`AuditType`, `AuditLogEntry`) are in `@kalio/types` — never redefine locally
- The BE's internal `guiDslAst.ts` full AST types are intentionally NOT in `@kalio/types` (they are structurally richer than the wire format and internal to the parser)
- When a new shared type is needed, add it to `@kalio/types` first, then import it everywhere

### Tool system
New tools follow this exact pattern:
```ts
@Injectable()
@Tool({ name: 'my_tool', description: '…', parameters: { … }, requiresConfirmation: false })
export class MyTool {
  async execute(request: ToolCallRequest): Promise<object> { … }
}
```
- Register in `ToolDispatchService` constructor injection + `executors` map
- Register in `ToolModule` providers array
- Prefer `@ConfirmedTool(...)` for mutating or persistent tools so confirmation policy stays consistent
- `requiresConfirmation: true` for destructive operations (delete, exec, overwrite)

## Link-First Docs

Prefer linking to focused architecture docs instead of duplicating long explanations:

- `docs/application-architecture-current.md` (system map)
- `docs/chat-streaming-tools-architecture.md` (chat + streaming)
- `docs/tool-architecture.md` (tool registry + execution)
- `docs/mcp-architecture.md` (MCP integration)
- `docs/raapp-design-current.md` and `docs/raapp-v2-architecture-current.md` (RA-App pipeline)
- `docs/database-schema-diagram.md` (DB relationships)

### Socket.IO event flow
```
FE → chat:send  →  Gateway.handleSend  →  ChatService.handleMessage
  ← chat:context  (system prompt + tool names for active turn)
  ← chat:chunk    (streaming delta, done=true on finish)
  ← tool:start    (tool call dispatched)
  ← tool:result   (ToolResult with callId, status, data)
  ← chat:complete (turn finished)
```
All event shapes are in `SocketEvents` type in `@kalio/types`. Never invent new event shapes without adding them there first.

### RA-App rendering
`raapp_create` tool returns `{ status: 'ready', type: 'html'|'gui', mode, content, renderedContent }`.
Frontend pipeline: `ToolCallBubble.extractRAAppBlock()` → `RAAppRenderer` → `HtmlIframeRenderer`.

Interactive RA-Apps send answers back via:
```js
window.parent.postMessage({ type: 'kalio_send_message', content: 'user answer' }, '*')
```
`HtmlIframeRenderer` intercepts this and calls `eventBus.sendMessage()` — no extra backend work needed.

## Conventions

### Naming
- Files: `kebab-case` (e.g. `chat-service.ts`, `vfs-write.tool.ts`)
- Classes: `PascalCase`, variables/methods: `camelCase`
- Test files: co-located with source as `*.spec.ts` (unit) or in `apps/e2e/tests/` (E2E)

### Module boundaries
- Modules communicate ONLY via `@kalio/types` — zero cross-module imports
- Exception: `VFSModule` and `ToolModule` are explicitly imported by `ChatModule`

### Error handling
- Never use empty `catch(() => {})` — always log with context and rethrow or handle
- `this.logger.error('message', err)` — always pass the Error object as second arg
- Use `instanceof Error ? err : new Error(String(err))` when wrapping unknown catches
- React async handlers (`useEffect`, event callbacks, `.then` chains): always add `.catch((err: unknown) => console.error('[ComponentName] context', err instanceof Error ? err : new Error(String(err))))` — never leave async paths without error handling

### Database (Drizzle)
- Schema source of truth: `apps/kalio-api/src/database/schema.ts`
- Migrations: `apps/kalio-api/src/database/migrations/` — single clean `0000_init.sql` baseline
- All DB access through `DrizzleService` — no raw SQLite calls
- Timestamps: `integer({ mode: 'timestamp_ms' })` → always `Date.now()` (Unix ms)

### Shared runtime rules
- `TimeoutSettingsService` is the source of truth for stored timeout defaults and max tool attempts
- Local-provider detection is intentionally mirrored between `apps/kalio-api/src/common/utils/local-llm-provider.util.ts` and `apps/kalio-web/src/features/settings/llm-provider-settings.ts`; update both together and keep the sync comments aligned

### Frontend state
- Session state: `useSessionStore` (Zustand) — messages, activeSessionId, sessions
- Agent/tool state: `useAgentStore` — streaming, toolActivities, llmActivities, context
- Settings: `useSettingsStore` — credentials, model config
- Access Zustand outside React hooks with `.getState()` — never call hooks in callbacks

### TypeScript
- `any` is **forbidden** — use `unknown` + narrowing or explicit types
- `as` casts are acceptable only at trust boundaries (Socket.IO payloads, DB rows)
- `satisfies` preferred over `as` for object literals with known type

## File Size Limit

**500 LOC hard limit per file** (tests exempt).
- React components: extract sub-components to `ComponentName.Part.tsx` or `components/` subfolder
- Services/controllers: extract helpers to `.utils.ts` or `.helpers.ts`

## Testing

- Unit: `vi.spyOn`, `vi.fn()`, never real HTTP/DB unless integration spec
- Integration: use real DrizzleService with in-memory SQLite (`':memory:'`)
- Mock LLM: always use `MockLLMProvider` — never call real API in tests
- E2E: Playwright in `apps/e2e/`, start server with `.\start-dev.ps1` before running
- Pre-existing failing test: `raapp.service.spec.ts` — 7 failures due to missing `ConfigService` mock — do NOT fix unless specifically asked
- Shared refs used inside `vi.mock()` factories should come from `vi.hoisted()`
- Zustand mocks touched from callbacks or services must expose `.getState()` to match runtime usage

### Windows gotchas

- Do not run `vite dev` with redirected or piped stdout/stderr on Windows; this can crash `@tailwindcss/oxide`.
- For scripted E2E startup on Windows, prefer frontend build + `vite preview` over Playwright `webServer` with `vite dev`.

### Test-driven bug fixes & review changes

**Every bug fix must be preceded by a failing test that reproduces the problem. Only apply the fix after the test fails.**
- Write or update a test that demonstrates the bug
- Run the test — confirm it fails with the expected error
- Apply the minimal fix
- Run the test again — confirm it passes

**Every code change requested during review must be confirmed by a test.**
- If review points out a missing edge case → write a test for that edge case first
- If review requests behavioral change → update existing tests or add new ones before modifying implementation
- Never apply review feedback without test coverage

## Agent Session Logging

- After every non-trivial task, create or append a session log in `docs/sessions/`
- Filename pattern: `YYYY-MM-DD-HH-MM-<brief-topic>.md`
- Include: what was done, files touched, decisions made, open questions, next steps
- These logs are for future agents (and humans) to reconstruct context quickly

## Forbidden

- `any` in TypeScript
- Cross-module imports (only `@kalio/types` crosses module boundaries)
- Empty catch blocks
- LLM calls from frontend — all LLM traffic goes through Socket.IO gateway
- Direct filesystem access outside `VFSService`
- Type duplication — all shared types in `@kalio/types/src/index.ts`
- `workspaceId` on any session/message/tool type — deliberately removed
- Modifying: `packages/@kalio/types/**`, `apps/kalio-api/src/main.ts`, `turbo.json`, `pnpm-workspace.yaml`, `drizzle.config.ts` without explicit ask
