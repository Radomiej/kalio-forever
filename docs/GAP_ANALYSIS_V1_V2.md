# Kalio v1 vs v2 — User-Facing Feature Gap Analysis

> **Date:** 2026-04-21
> **Purpose:** Analysis of missing user-facing features between ra-kingdom-stack (v1) and kalio-forever (v2)
> **Scope:** Features that users can see and interact with (not technical implementation details)

---

## Executive Summary

**v1 (ra-kingdom-stack)**: Production-ready with ~95% user-facing features implemented including MCP discovery, session management, creative tools (3D, music, voice), agent loops, skills, memory, and more.

**v2 (kalio-forever)**: Architectural rewrite with better foundation (NestJS, monorepo, Drizzle ORM) but only basic user-facing features implemented. Advanced features explicitly deferred to post-MVP.

**Key Trade-off**: v2 sacrifices user-facing features for better architecture. Users lose functionality now for better maintainability long-term.

---

## 1. User-Facing Feature Gaps

| Category | Feature | v1 (ra-kingdom-stack) | v2 (kalio-forever) | Priority |
|---|---|---|---|---|---|
| **Session Management** | Delete conversations | ✅ DELETE /api/sessions/:id | ❌ Missing | **HIGH** |
| | Session snapshots | ✅ Create/restore snapshots | ❌ Missing | **MEDIUM** |
| | Auto-generate session titles | ✅ POST /api/sessions/:id/generate-title | ❌ Missing | **MEDIUM** |
| | Session time tracking | ✅ Timestamps on messages | ⏳ Not verified | **LOW** |
| | HAF (Host Asset Folder) | ✅ VFS persistence across restart | ❌ Missing | **MEDIUM** |
| **MCP Integration** | Docker Desktop Gateway | ✅ MCP Discovery (scan local configs) | ❌ Missing | **HIGH** |
| | MCP server restart | ✅ POST /api/mcp/servers/:id/restart | ❌ Missing | **MEDIUM** |
| | MCP tool listing per server | ✅ GET /api/mcp/servers/:id/tools | ❌ Missing | **MEDIUM** |
| | MCP import from discovery | ✅ POST /api/mcp/discover/import | ❌ Missing | **MEDIUM** |
| **Built-in Tools** | Filesystem tools (read_file, list_dir, write_file) | ✅ FileSystemService | ❌ Missing | **HIGH** |
| | Terminal tools (spawn, list, kill) | ✅ TerminalService | ❌ Missing | **MEDIUM** |
| | KV storage tools (kv_write, kv_read, kv_list) | ✅ Built into ToolRouter | ❌ Missing | **MEDIUM** |
| | File search tools (file_search, grep_search) | ✅ FileSystemService | ❌ Missing | **MEDIUM** |
| **Creative Tools** | Image generation (DALL-E, Flux) | ✅ generate_image tool | ❌ Post-MVP | **MEDIUM** |
| | Image editing | ✅ edit_image tool | ❌ Post-MVP | **MEDIUM** |
| | 3D generation (Meshy) | ✅ generate_3d, generate_3d_from_image | ❌ Post-MVP | **MEDIUM** |
| | 3D refinement | ✅ refine_3d, rig_3d | ❌ Post-MVP | **MEDIUM** |
| | Music generation (Suno) | ✅ generate_music tool | ❌ Post-MVP | **MEDIUM** |
| | Voice TTS (ElevenLabs, Xiaomi MiMo) | ✅ speak endpoint | ❌ Post-MVP | **MEDIUM** |
| | Voice STT (transcription) | ✅ transcribe endpoint | ❌ Post-MVP | **MEDIUM** |
| **Agent System** | Agent Loops | ✅ Full CRUD + lifecycle | ⏳ Backend implemented, frontend placeholder | **HIGH** |
| | Active Agents panel | ✅ Real-time agent status | ✅ ConversationManagerPanel | **LOW** |
| | Subagent visualization | ✅ Canvas Drawer | ✅ CanvasPanel (tool activities, thinking) | **LOW** |
| | Orchestrator | ✅ Multi-agent coordination | ❌ Post-MVP | **HIGH** |
| | Coding Agent | ✅ copilot_cli integration | ❌ Post-MVP | **MEDIUM** |
| **Skills System** | Active workspace skills | ✅ Skills panel + editor | ⏳ Backend implemented, frontend placeholder | **HIGH** |
| | Skill sync registry | ✅ Real-time skill sync | ❌ Missing | **MEDIUM** |
| | Skill execution | ✅ Skills as tools | ❌ Missing | **MEDIUM** |
| **Memory System** | Semantic memory ingest | ✅ memory_ingest tool | ✅ MemoryPage (full ingest) | **LOW** |
| | Semantic memory search | ✅ memory_search tool (vector + FTS + hybrid) | ✅ MemoryPage (full search) | **LOW** |
| | Memory panel UI | ✅ Full memory management | ✅ MemoryPage (full implementation) | **LOW** |
| | Conversation ingest | ✅ memory_ingest_conversation | ❌ Missing | **MEDIUM** |
| **RA-Apps** | RA-App manager | ✅ Full CRUD + VFS integration | ⏳ Basic module, not tested | **HIGH** |
| | RA-App create from YAML | ✅ raapp_create tool | ❌ Missing | **MEDIUM** |
| | RA-App compile/validate | ✅ raapp_compile tool | ❌ Missing | **MEDIUM** |
| | RA-App test runner | ✅ raapp_test tool | ❌ Missing | **LOW** |
| | Rich media templates | ✅ Canvas 2D, Three.js, Tone.js | ❌ Post-MVP | **MEDIUM** |
| **Workspace System** | Workspace model config | ✅ Per-workspace LLM config | ⏳ Basic module, not tested | **HIGH** |
| | Workspace permissions | ✅ Auto-approve rules | ❌ Missing | **MEDIUM** |
| | Workspace memory entries | ✅ Per-workspace memory | ❌ Missing | **MEDIUM** |
| **UI Features** | Landing page | ✅ Full landing page | ✅ Basic landing | **LOW** |
| | Sidebar toggle | ✅ Collapsible sidebar | ✅ Basic sidebar with toggle | **LOW** |
| | Quick upload ZIP | ✅ Drag-drop RA-App upload | ⏳ Placeholder in App.tsx | **MEDIUM** |
| | Backend status badge | ✅ Online/offline indicator | ✅ BackendStatusBadge | **LOW** |
| | Audit Log panel | ✅ Full audit log viewer | ⏳ Placeholder only | **LOW** |
| | Context monitoring UI | ✅ Token count, context window status | ⏳ Basic stats in CanvasPanel | **MEDIUM** |
| | Auto-trim UI | ✅ Context auto-trim controls | ❌ Post-MVP | **MEDIUM** |
| **Integrations** | Telegram Bot | ✅ Full Telegram integration | ❌ Missing | **LOW** |
| | Filesystem access | ✅ Real filesystem (security-gated) | ❌ Missing | **MEDIUM** |
| **Infrastructure** | Docker support | ✅ docker-compose (minimal + full) | ❌ Not configured | **HIGH** |
| | GPU models (Ollama, BitNet, Qwen) | ✅ Local GPU model support | ❌ Not configured | **MEDIUM** |
| | PostgreSQL | ✅ Optional (graceful fallback) | ⏳ Drizzle adapter ready | **MEDIUM** |
| | Tauri Desktop | ✅ Desktop app with sidecar | ❌ Web-only | **LOW** |

---

## 2. Summary by Priority

### HIGH Priority (Critical for MVP)

1. **Delete conversations** - Users cannot remove unwanted sessions
2. **Docker Desktop Gateway for MCP** - Cannot auto-discover local MCP servers
3. **Agent Loops frontend** - Backend implemented, but frontend is placeholder
4. **Skills system frontend** - Backend implemented, but frontend is placeholder
5. **Filesystem tools** - Cannot read/write files outside VFS
6. **RA-App manager** - Basic module exists but not fully tested
7. **Workspace model config** - Basic module exists but not fully tested
8. **Docker support** - No containerized deployment
9. **Quick upload ZIP** - Placeholder only, not functional
10. **Session management features** - No snapshots, auto-titles, HAF persistence

### MEDIUM Priority (Important but not blocking)

1. **Terminal tools** - Cannot run shell commands
2. **KV storage tools** - No persistent key-value storage
3. **Creative tools** (3D, music, voice) - No creative generation (post-MVP)
4. **Orchestrator** - No multi-agent coordination (post-MVP)
5. **Coding Agent** - No copilot_cli integration (post-MVP)
6. **PostgreSQL** - Drizzle adapter ready but not configured
7. **GPU models** - No local GPU model support configured
8. **Conversation memory ingest** - No conversation-to-memory ingestion
9. **Workspace permissions** - No auto-approve rules
10. **Filesystem access** - No real filesystem access (security-gated)

### LOW Priority (Nice to have)

1. **RA-App compile/validate** - No built-in validation tools
2. **RA-App test runner** - No built-in testing
3. **Audit Log panel** - Placeholder only
4. **Telegram Bot** - No chatbot integration
5. **Tauri Desktop** - Web-only deployment
6. **Context monitoring UI** - Basic stats in CanvasPanel, no auto-trim
7. **Skill sync registry** - No real-time skill sync
8. **Skill execution** - No skills-as-tools integration

---

## 3. What Works in v2 (Basic Foundation)

✅ **Chat interface** - Basic chat with streaming
✅ **Persona selector** - Full CRUD for personas (PersonaPanel)
✅ **Settings modal** - Basic configuration
✅ **VFS explorer** - Session file management
✅ **MCP panel** - Full MCP server management (add, list, status)
✅ **RA-App renderer** - Display RA-App output
✅ **Credentials storage** - SQLite-based API key storage
✅ **LLM provider routing** - Multiple LLM providers
✅ **Real filesystem VFS** - Data persists across restart
✅ **Module boundaries** - Clean architecture
✅ **Memory system** - Full implementation (MemoryPage with search, ingest, delete, stats)
✅ **Active Agents panel** - ConversationManagerPanel for running agents
✅ **Canvas Panel** - Tool activities, thinking preview, session stats
✅ **Backend status badge** - Online/offline indicator
✅ **Sidebar toggle** - Collapsible sidebar
✅ **Agent Loops backend** - Full CRUD + lifecycle (controller, service)
✅ **Skills backend** - Full CRUD (controller, service)

---

## 4. Migration Notes

**What was preserved from v1:**
- Core chat/conversation concepts
- Tool execution framework
- VFS (improved with real filesystem)
- MCP integration (basic, but not discovery)
- RA-App DSL specification
- Persona/workspace concepts
- Memory system (fully re-implemented with vector search)
- Agent loops (backend fully re-implemented)

**What was intentionally deferred to post-MVP:**
- Multi-agent/orchestrator system
- Creative tools (3D, music, voice)
- Rich media engines
- Context monitoring (auto-trim)
- Coding agent

**What needs to be re-implemented:**
- Session management features (delete, snapshots, auto-titles, HAF)
- MCP discovery (Docker Desktop Gateway)
- Filesystem tools (read_file, list_dir, write_file)
- Terminal tools (spawn, list, kill)
- KV storage tools
- Agent Loops frontend (backend is ready)
- Skills frontend (backend is ready)
- Docker configuration

---

## 5. Recommendation

**For users:** v1 is currently more feature-complete for daily use. v2 has better architecture and several key features fully implemented (memory, persona, MCP, agent loops backend) but lacks some session management and advanced features.

**For developers:** v2 provides a clean architecture foundation with many backend modules already complete. The main work needed is:
- Frontend implementation for Agent Loops and Skills (backends are ready)
- Session management features (delete, snapshots, auto-titles)
- MCP discovery (Docker Desktop Gateway)
- Filesystem and terminal tools
- Docker configuration

**Timeline:** Estimate 1-2 weeks to complete frontend for Agent Loops and Skills, and 2-3 weeks for remaining HIGH priority features. Total: 3-5 weeks to reach feature parity with v1's core functionality.
