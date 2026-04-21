# 📦 MVP Spec — Kalio v2 (NestJS Rewrite)

> **Version:** 0.1 | **Date:** 2026-04-21 | **Status:** Draft
> **Owner:** Radko | **PO Gate:** wymagany przed startem pętli

---

## 1. 🎯 Cel

**Problem:** Kalio v1 (Express 5 + monolityczny ToolRouter 1335L) jest niemożliwy do skalowania — agenci się gubią w zależnościach, SQLite miesza się z PostgreSQL, brak DI uniemożliwia testowanie modułów w izolacji. Każda nowa funkcja to ryzyko regresji w całym systemie.

**Użytkownik:** Solo developer / power user który chce zlecać kompleksowe zadania agentom AI — od generowania kodu po operacje na plikach i zewnętrznych serwisach — bez konieczności pilnowania każdego kroku.

**Cel MVP:** Modularny monolith na NestJS gdzie każdy moduł ma jasny kontrakt, BE jest fat i świadomy stanu, FE jest thin i tylko renderuje. Wszystkie v1 must-have features działają na nowej architekturze.

---

## 2. 🧩 Zakres

| ✅ In Scope | ❌ Out of Scope |
|---|---|
| Chat z LLM — streaming, historia sesji, workspace context | Orchestrator / multi-agent (post-MVP) |
| Tool execution — native tools (vfs, web, terminal) | Forever Loop (post-MVP) |
| RA-App DSL — `display` + `interactive` (HITL) tryby | PostgreSQL (post-MVP, Drizzle adapter gotowy) |
| Persona — system prompt, model, skills, KV store, memory | Auth / JWT (post-MVP) |
| MCP integration — dynamic tool discovery | Team features (post-MVP) |
| VFS — real filesystem per conversationId | Production hardening — rate limiting, audit log |
| Credentials — API keys w SQLite przez UI | Migration tool z v1 (clean slate) |
| HITL gate — confirmation flow dla destruktywnych operacji | Audio / Video / 3D providers |

---

## 3. 🏗️ Stack i ograniczenia

- **Monorepo:** Turborepo + pnpm workspaces
- **Backend:** NestJS 11 + TypeScript 5.8 strict mode
- **Frontend:** React 19 + Vite 6 + Zustand 5 + TailwindCSS 4 + daisyUI 5
- **Realtime:** Socket.IO 4 (custom protocol — BE fat, FE thin)
- **ORM:** Drizzle ORM (better-sqlite3 dziś → node-postgres jutro, zero schema change)
- **Storage:** SQLite (personas, sessions, credentials, KV) + real filesystem VFS
- **Testing:** Vitest (unit/integration) + Playwright (E2E)

### Struktura monorepo
```
apps/
  kalio-api/          ← NestJS fat backend (port 3015)
  kalio-web/          ← React thin frontend (port 5187)
packages/
  @kalio/types        ← JEDYNY source of truth dla kontraktów
  @kalio/sdk          ← client SDK dla FE (Socket.IO wrapper)
```

### NestJS Modules
| Moduł | Odpowiedzialność |
|---|---|
| `ChatModule` | Sesje, historia, LLM streaming gateway |
| `PersonaModule` | Persona CRUD, system prompt, model config, skills, KV |
| `ToolModule` | Registry, dispatch, native tools, HITL gate |
| `VFSModule` | Filesystem per conversationId, path traversal guard |
| `MCPModule` | Client manager, dynamic tool discovery, watchdog |
| `RAAppModule` | DSL executor, sandbox, display/interactive modes |
| `CredentialsModule` | API keys storage (SQLite, encrypted post-MVP) |
| `LLMModule` | Provider routing (CometAPI / OpenRouter / Ollama / Mock) |

### Pliki których agent MAY dotykać
Wszystkie pliki w `apps/kalio-api/src/modules/[module-name]/` i `apps/kalio-web/src/`

### Pliki których agent MUST NOT dotykać bez sign-off
- `packages/@kalio/types/**` — zmiany kontraktów tylko przez PR review
- `apps/kalio-api/src/main.ts` — bootstrap
- `turbo.json` — pipeline config

### Contracts location
`packages/@kalio/types/src/index.ts` — **jedyny** source of truth. Zero duplikacji.

### i18n
Brak — embedded strings, no i18n system.

---

## 4. ⚙️ Environment Contract

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | ❌ | `3015` | Backend port |
| `NODE_ENV` | ❌ | `development` | |
| `DATABASE_PATH` | ✅ | `./data/kalio.db` | SQLite file path |
| `WORKSPACE_ROOT` | ✅ | `./data/workspaces` | Root dla VFS per conversation |
| `LLM_API_KEY` | ✅ | — | Default provider key (fallback) |
| `LLM_BASE_URL` | ✅ | — | Default provider base URL |
| `LLM_MODEL` | ✅ | — | Default model name |
| `VITE_API_URL` | ✅ | `http://localhost:3015` | FE → BE REST |
| `VITE_WS_URL` | ✅ | `http://localhost:3015` | FE → BE Socket.IO |

**Post-deploy steps (manual):**
- [ ] `pnpm drizzle-kit migrate` — uruchom migracje przy pierwszym starcie
- [ ] Utwórz `./data/workspaces/` jeśli `WORKSPACE_ROOT` nie istnieje (auto-mkdir w VFSModule)

**Startup validation:** `ConfigModule.forRoot({ validationSchema })` — NestJS fail-fast przy brakujących wymaganych vars.

---

## 5. 🚧 Architecture Rules

### Limity plików
| Typ | Soft | Hard |
|---|---|---|
| Controller / Gateway | 150 | 250 |
| Service | 300 | 400 |
| Module | 80 | 120 |
| Test file | 400 | 600 |
| React Component | 200 | 350 |

### Hard rules
- ❌ **Zero importów między modułami** poza `@kalio/types` — każdy moduł = czarna skrzynka
- ❌ Empty catch: `.catch(() => {})` — NIGDY
- ❌ `any` w TypeScript — NIGDY (strict mode)
- ❌ Duplikacja typów między BE i FE — NIGDY (tylko `@kalio/types`)
- ❌ LLM call z FE — NIGDY (tylko przez Socket.IO gateway)
- ❌ Direct filesystem access poza `VFSModule` — NIGDY
- ✅ Każdy tool: osobna klasa `@Injectable()` z dekoratorem `@Tool()`
- ✅ Każdy błąd: logowany + rethrown lub obsłużony z explicit fallback
- ✅ Nowe env vars: zawsze do §4 + `.env.example`
- ✅ `@Tool({ requiresConfirmation: true })` dla wszystkich destruktywnych operacji

### Module boundary enforcement
ESLint rule: `import/no-restricted-paths` — import z innego modułu bez przejścia przez `@kalio/types` = błąd w CI.

---

## 6. 🧨 Znany dług techniczny (z v1, nie powtarzamy)

| ID | Obszar | Opis | Priorytet | Dotykać? |
|---|---|---|---|---|
| TD-01 | ToolRouter.ts v1 | God object 1335L — zastąpiony przez `ToolModule` z klasami | P0 | ✅ fix (nowe podejście) |
| TD-02 | contracts.ts drift | BE/FE manual sync — zastąpiony przez `@kalio/types` | P0 | ✅ fix (nowe podejście) |
| TD-03 | ChatInterface.tsx v1 | God component 705L — FE thin w v2, zero logiki domenowej | P0 | ✅ fix (nowe podejście) |
| TD-04 | SQLite + PG mix | Brak adaptera — Drizzle rozwiązuje w v2 | P0 | ✅ fix (nowe podejście) |
| TD-05 | VFS in-memory | Restart = utrata — real filesystem od dnia 1 w v2 | P0 | ✅ fix (nowe podejście) |
| TD-06 | index.ts inline handlers | Socket.IO handlery inline — NestJS Gateways w v2 | P1 | ✅ fix (nowe podejście) |
| TD-07 | Setter injection | Brak DI container — NestJS DI od dnia 1 | P1 | ✅ fix (nowe podejście) |
| TD-08 | E2E LLM mock | Niemożliwy przez Socket.IO — `MockLLMProvider` injectable w v2 | P1 | ✅ fix (nowe podejście) |

> Wszystkie TD-P0 są rozwiązane przez samą architekturę v2. Agent NIE przenosi starych wzorców.

---

## 7. 📋 Acceptance Criteria

### Feature: Chat + LLM Streaming

| # | AC Statement | Test Type | Priorytet |
|---|---|---|---|
| AC-01 | Given user wysyła wiadomość → When agent streamuje odpowiedź → Then każdy chunk pojawia się w UI w <1s od pierwszego tokenu | e2e | 🔴 must |
| AC-02 | Given brak API key w Credentials → When user próbuje wysłać wiadomość → Then UI pokazuje inline error "Brak konfiguracji providera" przed wywołaniem LLM | e2e | 🔴 must |
| AC-03 | Given aktywna sesja z historią → When user otwiera ją ponownie po restarcie → Then wszystkie wiadomości widoczne w tej samej kolejności | e2e | 🔴 must |

### Feature: VFS (real filesystem)

| # | AC Statement | Test Type | Priorytet |
|---|---|---|---|
| AC-04 | Given agent wywołuje `vfs_write` z poprawną ścieżką → When tool wykonuje się → Then plik istnieje w `{WORKSPACE_ROOT}/conversations/{id}/files/` na dysku | unit + e2e | 🔴 must |
| AC-05 | Given agent próbuje zapisać plik z path `../other-conversation/secret.txt` → When tool `vfs_write` jest wywołany → Then zwraca error `PATH_TRAVERSAL_DENIED`, żaden plik nie jest tworzony | unit | 🔴 must |

### Feature: Tool Execution + HITL

| # | AC Statement | Test Type | Priorytet |
|---|---|---|---|
| AC-06 | Given agent wywołuje zarejestrowany native tool → When tool wykonuje się → Then wynik wraca do LLM jako `tool_result` w <5s | e2e | 🔴 must |
| AC-07 | Given nieznany tool name → When LLM próbuje go wywołać → Then agent dostaje `TOOL_NOT_FOUND`, sesja kontynuuje bez crasha | unit | 🔴 must |
| AC-08 | Given tool ma `requiresConfirmation: true` → When agent próbuje go wywołać → Then BE emituje `tool:confirmation_required`, FE pokazuje dialog OK/Cancel, operacja czeka | e2e | 🔴 must |
| AC-09 | Given dialog potwierdzenia wyświetlony → When user klika Cancel → Then tool nie wykonuje się, agent dostaje `TOOL_CANCELLED` w kontekście | e2e | 🔴 must |

### Feature: Persona

| # | AC Statement | Test Type | Priorytet |
|---|---|---|---|
| AC-10 | Given user tworzy Personę z system promptem i modelem → When otwiera nową sesję chat → Then LLM otrzymuje dokładnie ten system prompt i ten model z Persony | e2e | 🔴 must |
| AC-11 | Given Persona ma przypisane skills → When sesja startuje → Then agent widzi tylko skills tej Persony w tool registry | unit | 🔴 must |

### Feature: RA-App DSL

| # | AC Statement | Test Type | Priorytet |
|---|---|---|---|
| AC-12 | Given agent generuje poprawny blok `html` → When DSL jest parsowany → Then iframe renderuje się w chacie bez CSP błędów w konsoli | e2e | 🔴 must |
| AC-13 | Given agent generuje DSL z błędem składni → When renderer próbuje parsować → Then inline error w bańce chatu, sesja nie przerywa | unit | 🔴 must |

### Feature: MCP Integration

| # | AC Statement | Test Type | Priorytet |
|---|---|---|---|
| AC-14 | Given user dodaje MCP server URL w settings → When połączenie ustanawia się → Then nowe tools z MCP dostępne dla agenta w tej samej sesji bez restartu | e2e | 🔴 must |
| AC-15 | Given MCP server pada podczas sesji → When agent próbuje wywołać jego tool → Then dostaje `MCP_SERVER_UNAVAILABLE`, pozostałe tools działają normalnie | unit | 🔴 must |

---

## 8. 📊 Metryki sukcesu

| Metryka | Pytanie TAK/NIE | Komenda |
|---|---|---|
| M-01 TypeScript | Zero błędów `tsc --noEmit` we wszystkich packages? | `turbo typecheck` |
| M-02 Testy jednostkowe | Wszystkie moduły NestJS: 0 failów, ≥80% coverage? | `turbo test` |
| M-03 AC E2E | Wszystkie 15 AC mają passing Playwright test? | `turbo test:e2e` |
| M-04 LLM streaming | Pierwszy chunk w UI < 1000ms od wysłania? | Playwright `performance.now()` |
| M-05 Tool execution | Native tool wraca w < 5s? | AC-06 test |
| M-06 VFS isolation | Path traversal zablokowany 100% przypadków? | AC-05 unit test |
| M-07 Module boundary | Zero importów między modułami poza `@kalio/types`? | ESLint `import/no-restricted-paths` + `turbo lint` |
| M-08 Build | `turbo build` kończy się zerem na wszystkich packages? | `turbo build` |
| M-09 Linter | Zero ESLint errors we wszystkich packages? | `turbo lint` |

---

## 9. ✅ Definition of Done

### Kod
- [ ] Wszystkie 15 AC mają passing testy
- [ ] Żaden plik nie przekracza soft limitu
- [ ] Zero empty catches
- [ ] `turbo typecheck` = 0 błędów
- [ ] Zero `any` w TypeScript
- [ ] Każdy moduł: ≥80% coverage

### Kontrakty i środowisko
- [ ] Wszystkie typy w `packages/@kalio/types` — zero duplikacji
- [ ] Nowy env var → §4 + `.env.example` zaktualizowane
- [ ] `@kalio/types` zmiany → obie strony (BE + FE) zaktualizowane w tym samym PR

### Architektura
- [ ] Żaden moduł nie importuje bezpośrednio z innego modułu (tylko przez `@kalio/types`)
- [ ] Każdy tool = osobna `@Injectable()` klasa
- [ ] Destruktywne toole mają `requiresConfirmation: true`

### Testy
- [ ] Liczba failujących testów ≤ 0 (nowe repo, clean slate)
- [ ] MockLLMProvider injectable — E2E nie potrzebuje prawdziwego API key

### Cleanup
- [ ] Każdy plik: poniżej soft limitu
- [ ] Brak PNG screenshots tracked w repo

---

## 10. 🔁 Instrukcje dla agenta

```
LOOP START
  1. Przeczytaj §3 — potwierdź dozwolone pliki i module boundaries
  2. Sprawdź §4 — potwierdź że env vars istnieją w .env
  3. Internalizuj §5 — architecture rules to hard constraints, nie sugestie
  4. Sprawdź §6 — NIGDY nie przenoś wzorców z v1 (setter injection, inline handlers, god objects)
  5. Implementuj JEDNO AC na raz (podaj numer w output: "Implementing AC-04")
  6. Napisz test (unit lub e2e) dla tego AC PRZED implementacją (TDD)
  7. RED → implementuj → GREEN
  8. PASS: oznacz ✅ w §11, przejdź do następnego
  9. FAIL po 2 próbach: zgłoś do człowieka z opisem problemu, NIE poprawiaj w ciszy
  10. Po wszystkich AC: uruchom `turbo build && turbo typecheck && turbo lint && turbo test`, podaj wynik
LOOP END
```

**⛔ Stop conditions (czekaj na człowieka):**
| Trigger | Dlaczego |
|---|---|
| Potrzeba importu z innego modułu poza `@kalio/types` | Module boundary violation |
| Zmiana typów w `packages/@kalio/types` | Kontrakt zmiana — risk drift |
| Nowy env var potrzebny | Schema change → §4 update |
| Plik przekroczyłby hard limit | Refactor decision needed |
| 2+ faile na tym samym AC | Spec ambiguity |
| Wzorzec z v1 wydaje się konieczny | Architektura v2 ma rozwiązanie — zapytaj |
| Destruktywna operacja bez HITL gate | Security boundary |

---

## 11. 📊 AC Status Tracker

| AC | Status | Notatki |
|---|---|---|
| AC-01 LLM stream chunk <1s | ⬜ pending | |
| AC-02 Brak credentials → inline error | ⬜ pending | |
| AC-03 Historia sesji po restarcie | ⬜ pending | |
| AC-04 VFS write na dysk | ⬜ pending | |
| AC-05 Path traversal denied | ⬜ pending | |
| AC-06 Tool result <5s | ⬜ pending | |
| AC-07 Unknown tool → no crash | ⬜ pending | |
| AC-08 HITL confirmation dialog | ⬜ pending | |
| AC-09 HITL cancel → tool nie wykonuje się | ⬜ pending | |
| AC-10 Persona system prompt + model | ⬜ pending | |
| AC-11 Persona skills isolation | ⬜ pending | |
| AC-12 RA-App html render | ⬜ pending | |
| AC-13 RA-App DSL error inline | ⬜ pending | |
| AC-14 MCP hot-add bez restartu | ⬜ pending | |
| AC-15 MCP server down → graceful | ⬜ pending | |

> ⬜ pending → 🔄 in progress → ✅ done → ❌ blocked

---

## 12. 🔧 Cleanup Debt Tracker

| ID | Co | Plik | Status | Sesja |
|---|---|---|---|---|
| CL-01 | Nowe repo — clean slate | — | ✅ | 2026-04-21 |

---

## 13. 🧠 Changelog decyzji

| Data | Decyzja | Powód |
|---|---|---|
| 2026-04-21 | Full rewrite (nie migracja) | v1 god objects niemożliwe do incremental fix |
| 2026-04-21 | NestJS 11 zamiast Express 5 | DI container, moduły, testability — główna motywacja rewrite |
| 2026-04-21 | Drizzle ORM (nie TypeORM/Prisma) | SQLite dziś → PG jutro, type-safe, minimal overhead |
| 2026-04-21 | Real filesystem VFS (nie in-memory) | v1 restart = utrata danych — nieakceptowalne |
| 2026-04-21 | SQLite jako jedyna DB do MVP | PostgreSQL post-MVP, Drizzle adapter gotowy gdy potrzeba |
| 2026-04-21 | Credentials w SQLite przez UI | Wygoda użytkownika, szyfrowanie post-MVP |
| 2026-04-21 | `@kalio/types` jako jedyny kontrakt | Eliminacja drift który plagował v1 |
| 2026-04-21 | Socket.IO zostaje (custom protocol) | Działa, FE thin pattern nie wymaga zmiany |
| 2026-04-21 | RA-App: display + interactive (HITL) | Safety dla destruktywnych operacji |
| 2026-04-21 | Forever Loop + Orchestrator = post-MVP | Core modularność ważniejsza niż advanced features |
| 2026-04-21 | Auth = post-MVP | Local-only MVP, auth po walidacji |
| 2026-04-21 | Clean slate (nie migration tool) | v1 dane niekompatybilne z nowym modelem |

---

## 14. 🔍 PO Gate — przed startem pętli

- [ ] Wszystkie 15 AC behawioralne i weryfikowalne w Playwright/Vitest
- [ ] Min. 1 negative case na każdą funkcję (AC-02, AC-05, AC-07, AC-09, AC-13, AC-15)
- [ ] §4 Environment Contract kompletny z 9 vars
- [ ] §5 Architecture Rules potwierdzone (module boundary, tool klasy, HITL dekorator)
- [ ] §6 Tech Debt przejrzany — wszystkie P0 rozwiązane przez architekturę v2
- [ ] §9 DoD rozumiane przez agenta
- [ ] Turborepo pipeline skonfigurowany przed startem pętli (`turbo.json`)
- [ ] `packages/@kalio/types` setup przed jakimkolwiek modułem

**Sign-off:** _________________ | Data: _________

---

## 15. 📎 Powiązane pliki

- Instructions: `AGENTS.md` / `.cursorrules`
- Contracts: `packages/@kalio/types/src/index.ts`
- Playwright: `apps/kalio-web/playwright.config.ts`
- Drizzle schema: `apps/kalio-api/src/database/schema.ts`
- Env schema: `apps/kalio-api/src/config/env.schema.ts`
- Env example: `.env.example`
- Sessions: `docs/sessions/YYYY-MM-DD.md`
- Reference (v1): `../ra-kingdom-stack/` (read-only, logika referencyjna)
