# Kalio v2 vs Portal — Stack Comparison

> **Date:** 2026-04-21
> **Purpose:** Compare kalio-forever (AI chat interface) with Portal (cultural heritage CMS)

---

## Project Overview

| Aspect | Kalio v2 (kalio-forever) | Portal (portal-app) |
|---|---|---|
| **Purpose** | AI chat interface with LLM streaming, tool execution, HITL gates, VFS, persona management, MCP dynamic tool discovery | Digital cultural heritage portal - CMS for museum objects, galleries, search, RBAC |
| **Domain** | AI / Agent systems | Cultural heritage / CMS |
| **Target Users** | Solo developer / power user who wants to delegate complex tasks to AI agents | Museum administrators, managers, visitors |
| **Architecture** | NestJS 11 + Socket.IO backend, React 19 + Vite 6 frontend | Next.js 15 (App Router) frontend, NestJS 11 backend |

---

## Technology Stack Comparison

### Frontend

| Technology | Kalio v2 | Portal | Notes |
|---|---|---|---|
| **Framework** | React 19 + Vite 6 | Next.js 15 (App Router) | Portal uses SSR, Kalio is SPA |
| **State Management** | Zustand 5 | React hooks + server state | Kalio uses Zustand for client state |
| **Styling** | TailwindCSS 4 + daisyUI 5 | TailwindCSS 4 + daisyUI 5 | Same stack |
| **Realtime** | Socket.IO client (via @kalio/sdk) | REST API + polling | Kalio uses Socket.IO streaming |
| **Routing** | React Router (implied) | Next.js App Router | Portal has built-in routing |
| **i18n** | None (embedded strings) | Messages PL/EN | Portal has i18n |

### Backend

| Technology | Kalio v2 | Portal | Notes |
|---|---|---|---|
| **Framework** | NestJS 11 | NestJS 11 | Same framework |
| **API Style** | Socket.IO (fat backend, thin frontend) | REST API + optional SSE | Kalio is Socket.IO-first |
| **ORM** | Drizzle ORM + better-sqlite3 | Prisma ORM + PostgreSQL | Different ORM and database |
| **Database** | SQLite (real filesystem) | PostgreSQL | Kalio uses SQLite for MVP |
| **Cache** | None (in-memory) | Redis 7.x | Portal has Redis caching |
| **Search** | None | Meilisearch | Portal has dedicated search engine |
| **Auth** | None (post-MVP) | Better Auth | Portal has auth with RBAC |
| **Monitoring** | None | Grafana + Prometheus + Loki | Portal has full monitoring stack |

### Infrastructure

| Technology | Kalio v2 | Portal | Notes |
|---|---|---|---|
| **Monorepo** | Turborepo + pnpm workspaces | Turborepo + npm workspaces | Same monorepo approach |
| **Package Manager** | pnpm 9.15.0 | npm 10.9.0 | Different package managers |
| **Containerization** | None (local dev only) | Docker Compose (infra + optional tunnel) | Portal has Docker setup |
| **Testcontainers** | None | @testcontainers/postgresql, @testcontainers/redis | Portal uses testcontainers |
| **Performance Testing** | None | K6 | Portal has K6 integration |
| **Deployment** | Local dev only | Docker + Cloudflare Tunnel | Portal has production deployment |

### Testing

| Technology | Kalio v2 | Portal | Notes |
|---|---|---|---|
| **Unit Tests** | Vitest | Vitest | Same |
| **E2E Tests** | Playwright | Playwright | Same |
| **Coverage** | Vitest coverage | Vitest coverage + v8 | Same approach |
| **Test Data** | MockLLMProvider | Prisma seed | Different approaches |

---

## Architecture Patterns

### Backend Architecture

| Aspect | Kalio v2 | Portal |
|---|---|---|
| **Module Structure** | 8 NestJS modules (Chat, Persona, Tool, VFS, MCP, RAApp, Credentials, LLM) | Feature modules (auth, users, objects, galleries, system-mk) |
| **Module Boundaries** | ESLint import/no-restricted-paths enforced | Not explicitly enforced |
| **Contract Management** | @kalio/types package (single source of truth) | packages/shared (shared types, DTOs) |
| **Dependency Injection** | NestJS DI container | NestJS DI container |
| **API Gateway** | Socket.IO Gateway | REST Controllers |
| **Streaming** | Socket.IO streaming (LLM chunks) | Not applicable (CMS) |
| **Tool Execution** | ToolModule with @Tool decorator, HITL gate | Not applicable (CMS) |
| **VFS** | Real filesystem per conversationId | Not applicable (CMS) |
| **Persona Management** | PersonaModule (CRUD, system prompt, model, skills, KV) | Not applicable (CMS) |
| **MCP Integration** | MCPModule (dynamic tool discovery, watchdog) | Not applicable (CMS) |

### Frontend Architecture

| Aspect | Kalio v2 | Portal |
|---|---|---|
| **Architecture Pattern** | Thin frontend (renders state, emits events) | Next.js App Router (SSR + client components) |
| **State Management** | Zustand stores (agentStore, sessionStore) | React hooks + server state |
| **Realtime** | Socket.IO via @kalio/sdk | REST API calls |
| **Component Structure** | features/ directory (chat, persona, mcp, vfs, raapp, sessions, settings) | src/app/ routes (PL default, /en/) |
| **UI Components** | Custom components + daisyUI | Custom components + daisyUI |

---

## Feature Comparison

### Core Features

| Feature | Kalio v2 | Portal | Notes |
|---|---|---|---|
| **Chat with LLM** | ✅ (architecture done, not tested) | ❌ | Kalio-specific |
| **LLM Streaming** | ✅ (architecture done, not tested) | ❌ | Kalio-specific |
| **Tool Execution** | ✅ (architecture done, not tested) | ❌ | Kalio-specific |
| **HITL Gate** | ✅ (architecture done, not tested) | ❌ | Kalio-specific |
| **VFS** | ✅ (architecture done, not tested) | ❌ | Kalio-specific |
| **Persona Management** | ✅ (architecture done, not tested) | ❌ | Kalio-specific |
| **MCP Integration** | ✅ (architecture done, not tested) | ❌ | Kalio-specific |
| **RA-App DSL** | ✅ (architecture done, not tested) | ❌ | Kalio-specific |
| **CMS** | ❌ | ✅ | Portal-specific |
| **Object Management** | ❌ | ✅ | Portal-specific |
| **Gallery Management** | ❌ | ✅ | Portal-specific |
| **Search** | ❌ | ✅ (Meilisearch) | Portal-specific |
| **Auth** | ❌ (post-MVP) | ✅ (Better Auth + RBAC) | Portal-specific |
| **User Management** | ❌ | ✅ | Portal-specific |
| **Role-based Access** | ❌ | ✅ (RBAC) | Portal-specific |
| **System MK Integration** | ❌ | ✅ (Mock MK server) | Portal-specific |

### Advanced Features

| Feature | Kalio v2 | Portal |
|---|---|---|
| **Multi-Agent / Orchestrator** | ❌ (post-MVP) | ❌ |
| **Semantic Memory** | ❌ (post-MVP) | ❌ |
| **Image Generation** | ❌ (post-MVP) | ❌ |
| **3D Generation** | ❌ (post-MVP) | ❌ |
| **Rich Media Engines** | ❌ (post-MVP) | ❌ |
| **Monitoring Stack** | ❌ | ✅ (Grafana + Prometheus + Loki) |
| **Performance Testing** | ❌ | ✅ (K6) |
| **Docker Deployment** | ❌ | ✅ (Docker Compose + Cloudflare Tunnel) |
| **Testcontainers** | ❌ | ✅ (PostgreSQL, Redis) |

---

## Architecture Rules

### Kalio v2 (AGENTS.md)

- ✅ Zero cross-module imports (enforced by ESLint)
- ✅ No empty catch (forbidden)
- ✅ No `any` in TypeScript (strict mode)
- ✅ No LLM calls from FE (only through Socket.IO)
- ✅ No direct filesystem access outside VFSModule
- ✅ Each tool = separate @Injectable() class
- ✅ Every error logged + handled
- ✅ File size limits (Controller 150/250, Service 300/400, Module 80/120)
- ✅ TDD workflow mandatory
- ✅ @Tool({ requiresConfirmation: true }) for destructive operations

### Portal

- Not explicitly documented in AGENTS.md
- Uses Prisma for database access
- Has RBAC with Better Auth
- Has monitoring stack
- Has Docker deployment

---

## Development Workflow

### Kalio v2

```powershell
pnpm install              # Install dependencies
pnpm dev                  # Start dev servers (both API + web)
pnpm build                # Build all packages
pnpm typecheck            # Type-check all packages
pnpm lint                 # Lint all packages
pnpm test                 # Run unit tests
pnpm test:e2e             # Run E2E tests
pnpm audit                # Run code audit
pnpm audit:report         # Run audit + aggregate
```

### Portal

```powershell
npm install               # Install dependencies
docker compose up -d       # Start infrastructure (PostgreSQL, Redis, Meilisearch, monitoring)
npx prisma migrate deploy # Migrate database
npx prisma db seed        # Seed test data
npm run dev               # Start dev servers (BE + FE)
npm run build             # Build all packages
npm run typecheck         # Type-check all packages
npm run lint              # Lint all packages
npm run test              # Run unit tests
npm run test:e2e          # Run E2E tests
npm run test:performance  # Run K6 performance tests
```

---

## Key Differences Summary

### Domain & Purpose
- **Kalio v2:** AI chat interface for delegating complex tasks to AI agents
- **Portal:** Cultural heritage CMS for managing museum objects, galleries, search

### Backend API Style
- **Kalio v2:** Socket.IO-first (fat backend, thin frontend, streaming)
- **Portal:** REST API (traditional client-server, optional SSE)

### Database
- **Kalio v2:** SQLite with Drizzle ORM (simple, portable, MVP-focused)
- **Portal:** PostgreSQL with Prisma ORM (production-ready, scalable)

### Infrastructure
- **Kalio v2:** Local dev only, no Docker, no monitoring
- **Portal:** Docker Compose for infrastructure, monitoring stack, production deployment via Cloudflare Tunnel

### Auth & Security
- **Kalio v2:** None (post-MVP)
- **Portal:** Better Auth with RBAC (5 roles: ADMIN, RESOURCE_ADMIN, MANAGER, LOGGED_USER, ANONYMOUS)

### Search & Caching
- **Kalio v2:** None
- **Portal:** Meilisearch (search), Redis (cache)

### Testing
- **Kalio v2:** Vitest + Playwright, MockLLMProvider for testing
- **Portal:** Vitest + Playwright + K6 (performance), Testcontainers (PostgreSQL, Redis)

### Architecture Enforcement
- **Kalio v2:** Strict rules (module boundaries, file size limits, no empty catch, no `any`)
- **Portal:** Not explicitly enforced

### Deployment
- **Kalio v2:** Local dev only
- **Portal:** Docker Compose + Cloudflare Tunnel for production

---

## What Kalio v2 Can Learn from Portal

1. **Docker Setup** - Add docker-compose.yml for infrastructure
2. **Monitoring Stack** - Add Grafana + Prometheus + Loki for observability
3. **Testcontainers** - Use testcontainers for integration tests
4. **Performance Testing** - Add K6 for load testing
5. **Auth** - Consider Better Auth for post-MVP authentication
6. **Database Migration** - Prisma has better migration tooling than Drizzle

## What Portal Can Learn from Kalio v2

1. **Module Boundaries** - Enforce module boundaries with ESLint
2. **File Size Limits** - Add file size limits to prevent god objects
3. **No Empty Catch** - Enforce error handling
4. **No `any` Types** - Enforce strict typing
5. **TDD Workflow** - Mandate test-first development
6. **Single Contract Source** - Use dedicated package for contracts to prevent drift

---

## Conclusion

Kalio v2 and Portal are **completely different projects** with different domains and purposes:

- **Kalio v2** is an AI chat interface focused on LLM streaming, tool execution, HITL gates, VFS, persona management, and MCP integration. It uses Socket.IO for real-time communication and has strict architecture rules to prevent the god object problem that plagued v1.

- **Portal** is a cultural heritage CMS focused on managing museum objects, galleries, search, and user management with RBAC. It uses traditional REST API, PostgreSQL, Redis, Meilisearch, and has a full monitoring stack for production deployment.

The only similarities are:
- Both use NestJS 11 for backend
- Both use Turborepo for monorepo management
- Both use TailwindCSS + daisyUI for styling
- Both use Vitest + Playwright for testing

The key difference is that **Kalio v2 is an AI agent system** while **Portal is a traditional CMS**.
