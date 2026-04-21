# KALIO v2 — MVP Tracker

> **Last updated:** 2026-04-21
> **Overall:** Architecture 100% | AC Implementation 0% | Unit Tests 92 passing | E2E Tests 0% (stubs only)

---

## Current Call

- Decision: architecture is fully implemented, but ACs are not yet verified
- Internal demo: no (tests not passing)
- Solo/personal preview: no (tests not passing)
- Remaining work: implement TDD for all 15 AC, verify passing tests
- Source of truth: kalio-v2-mvp-spec.md §7 (15 AC)

---

## Dashboard

```text
Architecture:
  Monorepo Setup       #################### 100%  done
  Types Package       #################### 100%  done
  SDK Package          #################### 100%  done
  Backend Modules      #################### 100%  done
  Frontend Features    #################### 100%  done
  E2E Test Stubs       #################### 100%  done

AC Implementation:
  Chat + LLM Streaming -------------------- 0%  pending
  VFS (real filesystem) ------------------ 0%  pending
  Tool Execution + HITL ------------------ 0%  pending
  Persona -------------------------------- 0%  pending
  RA-App DSL ----------------------------- 0%  pending
  MCP Integration ------------------------ 0%  pending
```

---

## Verified Now

### Architecture (100% done)

- [x] Turborepo + pnpm workspaces
- [x] packages/@kalio/types (contracts - source of truth)
- [x] packages/@kalio/sdk (Socket.IO client wrapper)
- [x] apps/kalio-api with NestJS 11
  - [x] ChatModule (sessions, message history, LLM streaming gateway)
  - [x] PersonaModule (CRUD, system prompt, model config, skills, KV)
  - [x] ToolModule (registry, dispatch, native tools, HITL gate)
  - [x] VFSModule (filesystem per conversationId, path traversal guard)
  - [x] MCPModule (client manager, dynamic tool discovery, watchdog)
  - [x] RAAppModule (DSL executor, sandbox, display/interactive modes)
  - [x] CredentialsModule (API keys storage in SQLite)
  - [x] LLMModule (provider routing - OpenAI-compatible / Mock)
- [x] apps/kalio-web with React 19 + Vite 6
  - [x] Chat interface with message streaming
  - [x] Persona selector and session management
  - [x] Confirmation dialog for HITL gate
  - [x] MCP panel for server management
  - [x] VFS explorer
  - [x] Settings modal
  - [x] RA-App renderer
- [x] apps/e2e with Playwright
  - [x] Test stubs for all 15 AC (AC-01 through AC-15)
  - [x] webServer configuration for kalio-api and kalio-web
  - [x] NODE_ENV=test to use MockLLMProvider

### AC Implementation (0% - tests are stubs only)

All 15 AC have test stubs created, but none are passing yet. TDD workflow needs to be executed for each AC.

---

## Status by Area

### Core MVP

Status: architecture complete, ACs not verified.

- [x] monorepo structure (Turborepo + pnpm)
- [x] contracts package (@kalio/types)
- [x] SDK package (@kalio/sdk)
- [x] NestJS backend with 8 modules
- [x] React frontend with all features
- [x] Playwright E2E test stubs
- [ ] AC-01 through AC-15 passing tests
- [ ] Definition of Done met (see kalio-v2-mvp-spec.md §9)

### Testing and validation

Status: test infrastructure ready, unit tests passing, E2E tests not implemented.

- [x] Vitest configured for unit tests
- [x] Playwright configured for E2E tests
- [x] MockLLMProvider for testing
- [x] Test stubs for all 15 AC
- [x] Unit tests passing: 92 tests (77 in kalio-api + 15 in @kalio/types)
- [ ] Implement TDD for AC-01 (LLM streaming)
- [ ] Implement TDD for AC-02 through AC-15
- [ ] All 15 AC passing
- [ ] ≥80% coverage for all modules

### Post-MVP / deferred

- [ ] PostgreSQL migration (Drizzle adapter ready)
- [ ] Auth / JWT
- [ ] Team features
- [ ] Production hardening (rate limiting, audit log)

---

## What Changed Recently

### 2026-04-21

- Full rewrite of kalio v1 to kalio v2 (clean slate)
- Monorepo setup with Turborepo + pnpm workspaces
- All 8 NestJS modules implemented
- React frontend with all features implemented
- E2E test stubs for all 15 AC created
- Code audit scripts adapted from ra-kingdom-stack
- Initial audit shows: 0 CRITICAL, 2 HIGH (circular deps in LLM), 2 MEDIUM (unused deps)
- Fixed TypeScript error in @kalio/types test (missing 'provider' field in LLMConfig)
- Unit tests now passing: 92 tests (77 in kalio-api + 15 in @kalio/types)

---

## Current Risks and Caveats

- All 15 AC are marked as pending - E2E tests are stubs only
- Circular dependencies detected in LLM module (llm.service.ts → providers)
- Unused dependencies in kalio-web (lucide-react, react-markdown)
- Unit tests passing (92 tests) but E2E tests not implemented - cannot verify end-to-end functionality
- Architecture rules in AGENTS.md need to be enforced via ESLint

---

## Next Checkpoints

1. **AC-01 (Chat + LLM Streaming):** Implement test → RED → implement → GREEN
2. **AC-02 through AC-15:** Execute TDD workflow for each AC
3. **Fix circular dependencies** in LLM module (extract shared interfaces)
4. **Remove unused dependencies** from kalio-web
5. **Add ESLint rule** for module boundary enforcement (import/no-restricted-paths)
6. **Verify Definition of Done** (see kalio-v2-mvp-spec.md §9)

---

## AC Status (from kalio-v2-mvp-spec.md §11)

| AC | Status | Test Type | Priority |
|---|---|---|---|
| AC-01 LLM stream chunk <1s | ⬜ pending | e2e | 🔴 must |
| AC-02 Brak credentials → inline error | ⬜ pending | e2e | 🔴 must |
| AC-03 Historia sesji po restarcie | ⬜ pending | e2e | 🔴 must |
| AC-04 VFS write na dysk | ⬜ pending | unit + e2e | 🔴 must |
| AC-05 Path traversal denied | ⬜ pending | unit | 🔴 must |
| AC-06 Tool result <5s | ⬜ pending | e2e | 🔴 must |
| AC-07 Unknown tool → no crash | ⬜ pending | unit | 🔴 must |
| AC-08 HITL confirmation dialog | ⬜ pending | e2e | 🔴 must |
| AC-09 HITL cancel → tool nie wykonuje się | ⬜ pending | e2e | 🔴 must |
| AC-10 Persona system prompt + model | ⬜ pending | e2e | 🔴 must |
| AC-11 Persona skills isolation | ⬜ pending | unit | 🔴 must |
| AC-12 RA-App html render | ⬜ pending | e2e | 🔴 must |
| AC-13 RA-App DSL error inline | ⬜ pending | unit | 🔴 must |
| AC-14 MCP hot-add bez restartu | ⬜ pending | e2e | 🔴 must |
| AC-15 MCP server down → graceful | ⬜ pending | unit | 🔴 must |

---

## TDD Workflow (from kalio-v2-mvp-spec.md §10)

For each AC:
1. Read §7 - identify the AC being implemented
2. Write the test FIRST (unit in Vitest or E2E in Playwright)
3. Run tests → RED ❌
4. Implement the minimum code to pass
5. Run tests → GREEN ✅
6. Refactor if needed (no new test failures)
7. Update AC-Status Tracker in kalio-v2-mvp-spec.md §11

**After 2 consecutive failures on the same AC: stop and report to human.**

---

Tracking file. Update after verification sessions, not after speculative planning.
