# Kalio

> Local-first AI workspace. Chat with agents that have memory, tools, and a real filesystem.

---

## What is Kalio?

Kalio is a local-first AI workspace where you delegate tasks to LLM-powered agents through a real-time chat interface. Agents can:

- **Stream responses** with sub-second chunk latency
- **Execute tools** with a Human-in-the-Loop (HITL) confirmation gate
- **Read and write files** via a sandboxed Virtual File System (VFS)
- **Switch personas** — isolated system prompts, model configs, and tool sets
- **Discover new tools** dynamically via MCP (Model Context Protocol)
- **Render interactive mini-apps** with a built-in GUI DSL (RA-App)
- **Remember context** using per-persona vector memory (semantic + episodic)
- **Attach images** for multimodal conversations

All LLM traffic stays local — no cloud relay, no data leaving your machine except the LLM API call itself.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Monorepo** | Turborepo + pnpm workspaces |
| **Backend** | NestJS 11 + Socket.IO + Drizzle ORM |
| **Database** | SQLite (better-sqlite3) + sqlite-vec for semantic memory |
| **Frontend** | React 19 + Vite 6 + TailwindCSS 4 + daisyUI 5 |
| **State** | Zustand 5 |
| **Testing** | Vitest (unit/integration) + Playwright (E2E) |
| **Contracts** | `@kalio/types` — single source of truth for all BE↔FE types |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  kalio-web (React 19 + Vite 6)              │
│  ├─ Chat (streaming, attachments, turns)     │
│  ├─ Canvas (tool output, CLI live view)      │
│  ├─ Persona selector                         │
│  ├─ VFS explorer                             │
│  ├─ MCP server panel                         │
│  ├─ RA-App renderer (GUI DSL + HTML)         │
│  ├─ Memory & Observability pages             │
│  └─ Settings / HITL confirmation dialogs     │
└──────────────┬──────────────────────────────┘
               │ Socket.IO  (@kalio/sdk)
┌──────────────▼──────────────────────────────┐
│  kalio-api (NestJS 11)                      │
│  ├─ ChatModule   (sessions, agentic loop)    │
│  ├─ LLMModule    (OpenAI-compatible / Mock)  │
│  ├─ ToolModule   (registry, HITL gate)       │
│  ├─ VFSModule    (per-session filesystem)    │
│  ├─ PersonaModule(prompts, models, skills)   │
│  ├─ MCPModule    (dynamic tool discovery)    │
│  ├─ RAAppModule  (DSL executor, sandbox)     │
│  ├─ MemoryModule (vector + episodic)         │
│  ├─ ImageModule  (generation + viewing)      │
│  ├─ CLIAgentModule (subprocess runner)       │
│  └─ CredentialsModule (API key vault)        │
└─────────────────────────────────────────────┘
```

Socket event flow: `chat:send` → `chat:context` → `chat:chunk` → `tool:start` → `tool:result` → `chat:complete`

---

## Data Storage

| Storage | Purpose | Default path |
|---|---|---|
| **Relational DB** | Sessions, messages, personas, credentials, audit log | `./data/kalio.db` |
| **Vector memory** | Per-persona semantic embeddings (RAG) | `./data/memory/{personaId}.db` |
| **VFS** | Per-session sandboxed file workspace | `./data/workspaces/sessions/{sessionId}/files/` |

All paths are configurable via `.env`.

---

## Quick Start

### Requirements

- Node.js >= 22
- pnpm >= 9

### 1. Install

```bash
pnpm install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env — set LLM_PROVIDER and LLM_API_KEY
# Use LLM_PROVIDER=mock to run fully offline (no API key needed)
```

### 3. Run

```bash
# Windows
.\start-dev.ps1

# or manually (two terminals)
cd apps/kalio-api && pnpm start:dev
cd apps/kalio-web && pnpm dev
```

- API: http://localhost:3016
- Web: http://localhost:5188

### 4. Test

```bash
pnpm test        # unit + integration tests (Vitest)
pnpm test:e2e    # end-to-end tests (Playwright — requires running servers)
```

---

## LLM Providers

Any OpenAI-compatible endpoint works. Set in `.env`:

```env
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

| Provider | `LLM_PROVIDER` value | Notes |
|---|---|---|
| **Mock** | `mock` | Fully offline, ideal for dev/tests |
| **OpenAI** | `openai` | Standard GPT models |
| **OpenRouter** | `openrouter` | 200+ models via one API |
| **Ollama** | `ollama` | Local models (llama3, qwen3, etc.) |
| **Perplexity** | `perplexity` | Search-augmented models |

---

## Project Structure

```
kalio-forever/
├── apps/
│   ├── kalio-api/          # NestJS 11 backend
│   ├── kalio-web/          # React 19 frontend
│   └── e2e/                # Playwright E2E tests
├── packages/
│   ├── @kalio/types/       # Shared type contracts (DTOs, Socket events)
│   └── @kalio/sdk/         # Socket.IO client wrapper
├── docs/
│   ├── sessions/           # Development session logs (agentic history)
│   ├── spec/               # Design specs
│   └── assets/             # Screenshots & GIFs
├── scripts/
│   └── code-audit/         # Automated architecture health report
├── AGENTS.md               # Architecture rules for AI coding agents
├── .env.example            # Environment template (no real keys)
└── turbo.json              # Turborepo pipeline config
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide. Quick summary:

1. Read `AGENTS.md` — architecture rules enforced by CI
2. TDD: write the failing test first, then make it pass
3. 500 LOC hard limit per file (tests exempt)
4. Zero cross-module imports — use `@kalio/types` for all shared contracts
5. No `any` in TypeScript — use `unknown` + narrowing

---

## Roadmap

- [x] Core chat + streaming (Socket.IO, sub-second latency)
- [x] Tool system with HITL confirmation gate
- [x] Virtual File System (per-session sandboxed)
- [x] Persona system (prompts, model configs, skills)
- [x] MCP dynamic tool discovery
- [x] RA-App renderer (GUI DSL + HTML iframes)
- [x] Semantic memory (sqlite-vec RAG)
- [x] Image generation + multimodal input
- [x] CLI agent subprocess runner
- [x] Observability (audit log, token usage)
- [ ] Auth / JWT (post-MVP)
- [ ] PostgreSQL migration (Drizzle adapter ready)
- [ ] Remote VFS / S3 offload
- [ ] Multi-user / team features

---

## License

MIT

---

## Code of Conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
