# Kalio

> AI-native workspace. Chat, build, and iterate with agents that have memory, tools, and a filesystem.

<!-- GIF slot -- replace src with your demo once recorded -->
<p align="center">
  <img src="./docs/assets/kalio-demo.gif" alt="Kalio demo" width="800" />
  <br />
  <sub>🔔 <i>Place your demo GIF at <code>docs/assets/kalio-demo.gif</code></i></sub>
</p>

---

## What is Kalio?

Kalio is a local-first AI workspace where you delegate tasks to LLM-powered agents through a real-time chat interface. Agents can:

- **Stream responses** with sub-second chunk latency
- **Execute tools** with a Human-in-the-Loop (HITL) confirmation gate
- **Read and write files** via a sandboxed Virtual File System (VFS)
- **Switch personas** (system prompts + model configs + skill isolation)
- **Discover new tools** dynamically via MCP (Model Context Protocol)
- **Render interactive mini-apps** with a built-in GUI DSL (RA-App)
- **Attach images** for multimodal conversations

Built as a clean-slate rewrite (v2) to avoid the "god object" trap that plagued v1.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Monorepo** | Turborepo + pnpm workspaces |
| **Backend** | NestJS 11 + Socket.IO + Drizzle ORM |
| **Database** | SQLite (better-sqlite3), sqlite-vec for semantic memory |
| **Frontend** | React 19 + Vite 6 + TailwindCSS 4 + daisyUI 5 |
| **State** | Zustand 5 |
| **Testing** | Vitest (unit) + Playwright (E2E) |
| **Contracts** | `@kalio/types` — single source of truth |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  kalio-web (React 19 + Vite 6)              │
│  ├─ Chat (streaming, attachments, turns)     │
│  ├─ Persona selector                         │
│  ├─ VFS explorer                             │
│  ├─ MCP server panel                         │
│  ├─ RA-App renderer (GUI DSL)              │
│  └─ Settings / HITL dialogs                  │
└──────────────┬──────────────────────────────┘
               │ Socket.IO (@kalio/sdk)
┌──────────────▼──────────────────────────────┐
│  kalio-api (NestJS 11)                      │
│  ├─ ChatModule (sessions, streaming)         │
│  ├─ LLMModule (OpenAI-compatible / Mock)     │
│  ├─ ToolModule (registry, HITL gate)        │
│  ├─ VFSModule (per-conversation filesystem)  │
│  ├─ PersonaModule (prompts, models, skills)  │
│  ├─ MCPModule (dynamic tool discovery)       │
│  ├─ RAAppModule (DSL executor, sandbox)      │
│  ├─ MemoryModule (semantic + episodic)       │
│  └─ CredentialsModule (key storage)          │
└─────────────────────────────────────────────┘
```

---

## Quick Start

### Requirements

- Node.js >= 22
- pnpm >= 9

### 1. Install

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — set LLM_PROVIDER and LLM_API_KEY
# Use LLM_PROVIDER=mock to run without a real key
```

### 3. Run dev servers

```bash
pnpm dev
```

- API: http://localhost:3016
- Web: http://localhost:5188

### 4. Run tests

```bash
pnpm test        # unit tests (Vitest)
pnpm test:e2e    # end-to-end tests (Playwright)
```

---

## LLM Providers

Kalio supports any OpenAI-compatible endpoint:

| Provider | Config |
|---|---|
| **Mock** | `LLM_PROVIDER=mock` — runs offline, great for dev/tests |
| **OpenAI** | `LLM_PROVIDER=openai` + your `sk-...` key |
| **OpenRouter** | `LLM_PROVIDER=openrouter` + `sk-or-v1-...` |
| **CometAPI** | `LLM_PROVIDER=cometapi` — cheap OpenAI proxy |
| **MiniMax** | `LLM_PROVIDER=xiaomimimo` |
| **Ollama** | `LLM_PROVIDER=ollama` — local models |

Set in `.env`:
```
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

---

## Project Structure

```
kalio-forever/
├── apps/
│   ├── kalio-api/          # NestJS backend
│   ├── kalio-web/          # React frontend
│   └── e2e/                # Playwright E2E tests
├── packages/
│   ├── @kalio/types/       # Shared contracts (DTOs, events)
│   └── @kalio/sdk/         # Socket.IO client wrapper
├── docs/
│   ├── spec/               # Design specs
│   └── assets/             # Screenshots & GIFs
├── scripts/
│   └── code-audit/         # Automated architecture audit
├── .env.example            # Template (no real keys)
├── start-dev.ps1           # Dev launcher (API + web)
└── turbo.json              # Pipeline config
```

---

## Contributing

1. Read `AGENTS.md` — architecture rules are enforced
2. Follow TDD: write the test first, then make it pass
3. Keep files under 500 LOC (hard limit)
4. Zero cross-module imports — use `@kalio/types` for contracts

---

## Roadmap

- [x] Architecture (100%)
- [x] Unit tests passing (92)
- [ ] E2E tests for 15 ACs (in progress)
- [ ] Auth / JWT (post-MVP)
- [ ] PostgreSQL migration (Drizzle adapter ready)
- [ ] Team features

---

## License

MIT
