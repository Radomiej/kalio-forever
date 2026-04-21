# Kalio v1 vs v2 — Feature Comparison

> **Date:** 2026-04-21
> **Purpose:** Compare ra-kingdom-stack (v1) with kalio-forever (v2) to identify gaps and differences

---

## Architecture Overview

| Aspect | v1 (ra-kingdom-stack) | v2 (kalio-forever) | Status |
|---|---|---|---|
| **Backend Framework** | Express 5 | NestJS 11 | ✅ Different (v2 is more structured) |
| **Frontend Framework** | React 19 + Vite 6 + Zustand + TailwindCSS 4 | React 19 + Vite 6 + Zustand + TailwindCSS 4 + daisyUI 5 | ✅ v2 adds daisyUI |
| **Structure** | Monolith (kalio-backend + kalio-frontend) | Turborepo monorepo (apps/ + packages/) | ✅ v2 is monorepo |
| **Contract Management** | contracts.ts (manual sync) | @kalio/types package (single source of truth) | ✅ v2 eliminates drift |
| **Dependency Injection** | Manual / global state | NestJS DI container | ✅ v2 has proper DI |
| **ORM** | Direct SQLite with custom repositories | Drizzle ORM with better-sqlite3 | ✅ v2 has type-safe ORM |
| **Database** | SQLite (in-memory VFS) | SQLite (real filesystem VFS) | ✅ v2 persists data |
| **Socket.IO Handler** | Inline in index.ts | NestJS @WebSocketGateway() | ✅ v2 is testable |
| **Module Boundaries** | No enforcement | ESLint import/no-restricted-paths | ✅ v2 enforces boundaries |

---

## Feature Comparison

### Core Features

| Feature | v1 | v2 | Notes |
|---|---|---|---|
| Chat + LLM Streaming | ✅ | ⏳ Architecture done, AC not verified | v2 has ChatModule but tests not passing |
| Tool Execution | ✅ ToolRouter (1335L god object) | ⏳ ToolModule with classes | v2 is modular, not tested yet |
| HITL Gate | ✅ | ⏳ ToolModule has @Tool decorator | v2 has decorator, not tested |
| VFS | ✅ In-memory (restart = data loss) | ⏳ Real filesystem | v2 persists data, not tested |
| Persona | ✅ | ⏳ PersonaModule | v2 has module, not tested |
| MCP Integration | ✅ | ⏳ MCPModule | v2 has module, not tested |
| RA-App DSL | ✅ | ⏳ RAAppModule | v2 has module, not tested |
| Credentials | ✅ (in-memory?) | ⏳ CredentialsModule (SQLite) | v2 persists to SQLite, not tested |

### Advanced Features (v1 only)

| Feature | v1 | v2 | Notes |
|---|---|---|---|
| **Multi-Agent / Orchestrator** | ✅ OrchestratorService + subagents | ❌ Post-MVP | v2 explicitly deferred |
| **Semantic Memory** | ✅ SQLite-based with embeddings | ❌ Post-MVP | v2 explicitly deferred |
| **Memory Search** | ✅ memory_ingest, memory_search | ❌ Post-MVP | v2 explicitly deferred |
| **Image Generation** | ✅ generate_image tool | ❌ Post-MVP | v2 explicitly deferred |
| **Image Editing** | ✅ edit_image tool | ❌ Post-MVP | v2 explicitly deferred |
| **Image-to-3D** | ✅ Meshy pipeline | ❌ Post-MVP | v2 explicitly deferred |
| **Text-to-3D** | ✅ Meshy pipeline | ❌ Post-MVP | v2 explicitly deferred |
| **Rich Media Engines** | ✅ Canvas 2D, Three.js, Tone.js | ❌ Post-MVP | v2 explicitly deferred |
| **Context Monitoring** | ✅ Auto-trim UI | ❌ Post-MVP | v2 explicitly deferred |
| **Workspace Skills** | ✅ Active skills system | ⏳ PersonaModule has skills | v2 has skills in Persona, not tested |
| **Coding Agent** | ✅ Integrated in orchestrator | ❌ Post-MVP | v2 explicitly deferred |

### Architecture Improvements (v2 only)

| Feature | v1 | v2 | Notes |
|---|---|---|---|
| **Monorepo** | ❌ | ✅ Turborepo + pnpm workspaces | v2 is monorepo |
| **Single Contract Source** | ❌ Manual sync drift | ✅ @kalio/types package | v2 eliminates drift |
| **Type-Safe ORM** | ❌ Custom repositories | ✅ Drizzle ORM | v2 has type-safe queries |
| **Real Filesystem VFS** | ❌ In-memory | ✅ Real filesystem | v2 persists data |
| **Module Boundaries** | ❌ No enforcement | ✅ ESLint enforcement | v2 prevents cross-module imports |
| **File Size Limits** | ❌ No limits | ✅ Enforced per AGENTS.md | v2 prevents god objects |
| **No Empty Catch** | ❌ Pattern existed | ✅ Forbidden by AGENTS.md | v2 enforces error handling |
| **No `any` Types** | ❌ Pattern existed | ✅ Forbidden by AGENTS.md | v2 enforces strict typing |
| **Testable Modules** | ❌ Hard to test | ✅ NestJS DI + modules | v2 is testable |
| **TDD Workflow** | ❌ Not enforced | ✅ Mandatory per spec | v2 requires test-first |
| **HITL Decorator** | ❌ Manual checks | ✅ @Tool({ requiresConfirmation }) | v2 has declarative HITL |

---

## What v1 Has That v2 Does NOT (Yet)

### Core v1 Features Missing in v2 MVP

1. **Multi-Agent / Orchestrator**
   - v1: OrchestratorService routing and subagent execution
   - v2: Explicitly deferred to post-MVP

2. **Semantic Memory**
   - v1: SQLite-based with embeddings, memory_ingest/memory_search tools
   - v2: Explicitly deferred to post-MVP

3. **Image Generation & Editing**
   - v1: generate_image, edit_image tools with async polling
   - v2: Explicitly deferred to post-MVP

4. **3D Generation**
   - v1: image-to-3D, text-to-3D, refine via Meshy
   - v2: Explicitly deferred to post-MVP

5. **Rich Media Engines**
   - v1: Canvas 2D, Three.js, Tone.js templates
   - v2: Explicitly deferred to post-MVP

6. **Context Monitoring**
   - v1: Auto-trim UI for context management
   - v2: Explicitly deferred to post-MVP

7. **Coding Agent**
   - v1: Integrated in orchestrator pipeline
   - v2: Explicitly deferred to post-MVP

### v1 Infrastructure Missing in v2

1. **Tauri Desktop App**
   - v1: src-tauri with desktop sidecar
   - v2: Web-only (Tauri not in scope)

2. **Docker Support**
   - v1: docker-compose.yml for deployment
   - v2: Not yet configured

3. **Production Auth**
   - v1: Not implemented
   - v2: Explicitly deferred to post-MVP

---

## What v2 Has That v1 Does NOT

### Architecture Improvements

1. **Monorepo Structure**
   - v2: Turborepo + pnpm workspaces with apps/ and packages/
   - v1: Monolith with kalio-backend and kalio-frontend

2. **Single Contract Source**
   - v2: @kalio/types package as only source of truth
   - v1: contracts.ts with manual sync drift

3. **Type-Safe ORM**
   - v2: Drizzle ORM with better-sqlite3, type-safe queries
   - v1: Custom repositories with manual SQL

4. **Real Filesystem VFS**
   - v2: Real filesystem per conversationId (data persists)
   - v1: In-memory VFS (restart = data loss)

5. **Module Boundaries**
   - v2: ESLint import/no-restricted-paths enforces zero cross-module imports
   - v1: No enforcement, modules could import from each other

6. **File Size Limits**
   - v2: Enforced per AGENTS.md (Controller 150/250, Service 300/400, etc.)
   - v1: No limits, god objects like ToolRouter.ts (1335L)

7. **No Empty Catch**
   - v2: Forbidden by AGENTS.md, enforced by lint
   - v1: Pattern existed (silent errors)

8. **No `any` Types**
   - v2: Forbidden by AGENTS.md, enforced by strict TypeScript
   - v1: Pattern existed

9. **Testable Modules**
   - v2: NestJS DI container makes modules testable in isolation
   - v1: Hard to test modules due to global state and lack of DI

10. **TDD Workflow**
    - v2: Mandatory per spec, write test first
    - v1: Not enforced

11. **HITL Decorator**
    - v2: @Tool({ requiresConfirmation: true }) declarative
    - v1: Manual checks

12. **SDK Package**
    - v2: @kalio/sdk as typed Socket.IO wrapper
    - v1: Direct Socket.IO usage in frontend

---

## Summary

### v1 Status
- **Core MVP:** ~95% complete (demoable)
- **Advanced Features:** Orchestrator, semantic memory, image/3D generation, rich media engines
- **Architecture Issues:** God objects, contract drift, in-memory VFS, no module boundaries, silent errors

### v2 Status
- **Architecture:** 100% complete (NestJS modules, monorepo, Drizzle ORM, real filesystem)
- **Core MVP:** 0% verified (architecture done, but tests not passing)
- **Advanced Features:** Explicitly deferred to post-MVP
- **Architecture Improvements:** Module boundaries, file size limits, no empty catch, no `any`, TDD workflow

### Key Decision
v2 is a **full architectural rewrite** that trades advanced features (orchestrator, memory, image/3D) for:
- Testability (NestJS DI, modules)
- Maintainability (module boundaries, file size limits)
- Data persistence (real filesystem VFS)
- Type safety (Drizzle ORM, @kalio/types)
- Developer experience (TDD workflow, no god objects)

The advanced features from v1 are explicitly deferred to post-MVP in v2 to focus on getting the core architecture right first.
