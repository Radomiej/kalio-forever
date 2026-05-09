---
name: arch-review
description: "Architecture review skill for Kalio-Forever (NestJS 11 + React 19 + Socket.IO + Drizzle/SQLite + Turborepo). Use when: reviewing app architecture, identifying pitfalls, assessing scalability, checking module boundaries, auditing type contracts, evaluating technical debt, analyzing coupling, planning feature additions. Also use when asked about 'architecture', 'bird's eye view', 'risks', 'recommendations', 'tech debt', 'scalability', 'evolution of the system'."
argument-hint: "Optional focus area: 'backend', 'frontend', 'types', 'security', 'scalability', 'full' (default: full)"
---

# Architecture Review — Kalio-Forever

Produces a structured **architectural assessment** of the Kalio-Forever monorepo from a senior architect's perspective. Covers module boundaries, type contracts, coupling, scalability ceilings, security posture, and prioritized recommendations.

## When to Use

- "Review the architecture of our app"
- "What are the biggest risks/pitfalls in our codebase?"
- "What should we watch out for when adding X feature?"
- "Is the app ready to scale?"
- "Identify technical debt hotspots"
- "Bird's eye view of how FE and BE fit together"

---

## Review Procedure

### Phase 1 — Inventory (always run this first)

1. Read [AGENTS.md](../../../AGENTS.md) and [copilot-instructions.md](../../copilot-instructions.md) to confirm current conventions.
2. List all backend modules: `apps/kalio-api/src/modules/`
3. List all frontend features: `apps/kalio-web/src/features/`
4. List Zustand stores: `apps/kalio-web/src/store/`
5. Read `packages/@kalio/types/src/index.ts` — full scan, note any newly added types.
6. Read `apps/kalio-api/src/database/schema.ts` — note all tables, FKs, constraints.
7. Check `apps/kalio-api/src/modules/chat/chat.service.ts` (agentic loop entry point).

Produce: **Module Map** + **Dependency Graph** (text form).

---

### Phase 2 — Convention Compliance Checks

Run these checks across the codebase and flag violations:

| Rule | Check Method | Severity |
|------|-------------|----------|
| No `any` in TypeScript | `grep_search "`: any`\|: any[,;)\]]"` across `src/` | HIGH |
| No cross-module imports (only `@kalio/types` crosses) | grep for `import.*from.*modules/` outside same module | HIGH |
| No empty catch blocks | grep for `catch.*{[^}]*}` or `.catch\s*\(\s*\)` | HIGH |
| File LOC within hard limits (non-test) | run `node scripts/code-audit/run-audit.mjs` then `aggregate.mjs`; any 🔴 CRITICAL in report = violation | HIGH |
| All shared types in `@kalio/types` | grep for `interface\|type =` in `modules/` or `features/` that duplicate `@kalio/types` entries | HIGH |
| No `workspaceId` on session/message/tool types | grep for `workspaceId` | MEDIUM |
| Socket events defined in `SocketEvents` interface | check that new socket emits reference the type | MEDIUM |
| `requiresConfirmation: true` on destructive tools | scan `@Tool()` decorators | HIGH |

---

### Phase 3 — Architecture Quality Axes

Evaluate each axis. Provide a **RAG rating** (🟢 Good / 🟡 Watch / 🔴 Risk) + 1–3 sentence justification + recommendation if not green.

#### 3.1 Module Isolation
- Are all cross-module communication paths going through `@kalio/types`?
- Is `ChatModule` the only one importing `VFSModule` and `ToolModule` explicitly?
- Are there any service class imports across module folders?

#### 3.2 Type Contract Health
- Is `@kalio/types/src/index.ts` approaching 500 LOC? (Single-source rule becomes risky above that.)
- Are wire types (GUI DSL, Audit, RA-App) clean vs internal AST types?
- Are event shapes consistently typed via `SocketEvents`?

#### 3.3 Scalability Ceilings
Evaluate against **known hard limits** of the current stack:

| Component | Current | Ceiling | Action Trigger |
|-----------|---------|---------|----------------|
| SQLite (single file) | sessions, messages, vectors | ~100k rows OK, >1M rows → perf degrades | When approaching 100k messages or 50k vector rows |
| In-process vector store | per-persona isolated | RAM-bound; ~50k 1536-dim vecs ≈ 300 MB | When multiple high-volume personas active |
| Socket.IO (single node) | session-scoped connections | ~10k concurrent WebSocket conns on one process | When multi-instance needed |
| VFS (local disk) | per-session files | Disk-bound; no CDN/S3 offload | When file sizes grow large |
| LLM streaming (single gateway) | no backpressure queue | No queue: slow clients can cause backlog | When multiple concurrent agentic turns needed |
| Turborepo build cache | local disk only | No remote cache configured | When CI builds become slow |

#### 3.4 Security Posture
- **Credential storage**: Are LLM API keys persisted in DB without encryption? (Post-MVP gap noted in schema comments — verify current state.)
- **Path traversal**: Confirm `AllowedPathsService` covers all `fs_*` tool calls, not just VFS.
- **SSRF**: Confirm `isPrivateUrl()` is enforced in `http_fetch` native system.
- **RA-App sandbox**: Is `vm` sandbox used in `EffectsProcessorService`? Does it block `require` / `process`?
- **Cross-session approval**: Verify ChatGateway rejects `raapp:approve` from wrong `sessionId`.
- **API keys in logs**: Grep for accidental `this.logger.log(credential)` patterns.

#### 3.5 Frontend State Coherence
- Does `useSessionStore` stay consistent when multiple tabs are open? (No cross-tab sync = potential stale state.)
- Is `useAgentStore.pendingConfirmation` cleared on session switch?
- Are `streamingChunks` and `agentTurns` properly garbage-collected after turn completion?
- Are Zustand stores accessed outside React hooks via `.getState()`? (Required for Socket.IO callbacks — verify not using hooks in event handlers.)

#### 3.6 Test Coverage Integrity

Run actual coverage — do not estimate:

```powershell
# Backend coverage
cd apps/kalio-api
node_modules\.bin\vitest.CMD run --coverage 2>&1 | Select-String "Stmts|Branch|Funcs|Lines|Uncovered" | Select-Object -First 30

# Frontend coverage
cd apps/kalio-web
node_modules\.bin\vitest.CMD run --coverage 2>&1 | Select-String "Stmts|Branch|Funcs|Lines|Uncovered" | Select-Object -First 30
```

Coverage gates (flag if below):

| Module | Min Statements | Min Branches | Priority |
|--------|---------------|--------------|----------|
| `modules/chat` | 80% | 70% | CRITICAL |
| `modules/tool` | 75% | 65% | HIGH |
| `modules/raapp` | 70% | 60% | HIGH |
| `modules/vfs` | 75% | 65% | HIGH |
| `features/chat` | 70% | 60% | HIGH |
| All others | 60% | 50% | MEDIUM |

Also run the static audit pipeline:
```powershell
cd c:\Projekty\kalio-forever
node scripts/code-audit/run-audit.mjs   # collects raw data → docs/audit/raw/
node scripts/code-audit/aggregate.mjs   # produces docs/audit/<date>-report.md
```
Read the generated `docs/audit/<date>-report.md` — surface all 🔴 CRITICAL and 🟡 HIGH items.

Known gap: `raapp.service.spec.ts` has 7 pre-existing failures (ConfigService mock missing) — document as tech debt, do not fix unless explicitly asked.

#### 3.7 Observability & Operability
- Is `audit_log` table used for all significant operations (native calls, HITL decisions, credential use)?
- Is there a health endpoint (`/health` or similar) for deployment monitoring?
- Are error events emitted to frontend via `chat:error` with enough context to diagnose?
- Is there structured logging (JSON) or just raw `console.log`?

---

### Phase 4 — Pitfall Catalogue (Project-Specific)

Always surface these known architectural traps for this codebase:

**Backend Pitfalls**:
1. **`@kalio/types` growing unbounded**: As features grow, types will pile up. Without splitting into sub-files, this becomes a 2000+ LOC God file. Recommendation: namespace guard — consider sub-files by domain under `packages/@kalio/types/src/` with a barrel `index.ts`.
2. **SQLite write serialization**: SQLite has a single writer lock. Concurrent agentic turns (multiple sessions active simultaneously) will serialize DB writes. Under load, this creates latency spikes in message persistence.
3. **In-process vector store**: `VectorStoreService` lives in the same Node.js process as the API. Large vector stores can cause GC pressure. No graceful degradation if embedding service is unavailable.
4. **Session-scoped VFS but no cleanup**: Per-session files accumulate at `{WORKSPACE_ROOT}/sessions/{sessionId}/files/`. There is no TTL, archival, or cleanup policy. Disk grows unbounded over time.
5. **Max 8 agentic iterations hardcoded**: The loop limit in `ChatService` is a magic constant. Complex agent tasks silently truncate. Should be configurable per persona.
6. **MCP tool registration is global**: MCP tools are registered globally, not scoped to the persona that enabled a given MCP server. This could expose MCP tools to personas that shouldn't have them.
7. **No rate limiting on Socket.IO gateway**: A single client can flood the `chat:send` handler with rapid fire messages, queueing unlimited LLM calls per session.
8. **Confirmation timeout is global (30s)**: No per-tool override for timeouts. Some confirmations (destructive, slow operations) may need longer; others can be tighter.

**Frontend Pitfalls**:
9. **`useContextUsage.ts` uses `(s: any)`**: The `any` cast in the Zustand selector bypasses type safety. If the store shape changes, this silently breaks.
10. **No offline / reconnect handling in KalioSDK**: If the Socket.IO connection drops mid-stream, the FE has no automatic reconnect-and-resume. The user sees a frozen streaming UI.
11. **RA-App `window.parent.postMessage` is unguarded**: The `HtmlIframeRenderer` listens for `kalio_send_message` without origin validation. A malicious RA-App could send arbitrary messages from a sandboxed iframe. Should check `event.origin` or use `srcdoc` with CSP `sandbox` attribute.
12. **Zustand stores hold streaming state indefinitely**: `streamingChunks` and `thinkingChunks` records are never pruned after turn completion. In long sessions with many tool calls, memory leaks gradually.

---

### Phase 5 — Recommendations Output

Format findings as a **prioritized action list** grouped by urgency:

#### 🔴 Immediate (before next major feature)
- [ ] Items that are security risks or break correctness

#### 🟡 Short-term (next sprint/quarter)
- [ ] Items that are technical debt or scalability risks

#### 🟢 Long-term (roadmap consideration)
- [ ] Items that are architectural evolution opportunities

---

### Phase 6 — Evolution Readiness (Roadmap Review)

> Skip this phase if the request is a general review with no specific feature mentioned.

If a specific new feature is being considered, evaluate it against:

1. **Module placement**: Which module should own it? Does it cross module boundaries?
2. **Type contract impact**: Will it require new types in `@kalio/types`? Any breaking changes?
3. **DB schema impact**: New tables? Schema migration needed?
4. **Socket.IO event impact**: New events? Add to `SocketEvents` first.
5. **Test strategy**: Unit → Integration → E2E test plan before implementation.
6. **File size impact**: Will the target service/component exceed 500 LOC after the addition?

---

### Phase 7 — Session Log (always run last)

After completing the review, create a session log in `docs/sessions/`:

- Filename: `YYYY-MM-DD-HH-MM-arch-review.md`
- Sections:
  - **What was reviewed**: scope, focus area, date
  - **Key findings**: RAG ratings per axis with one-line justification
  - **🔴 Critical items**: copy from Phase 5 immediate list
  - **Files/modules touched**: anything read or analysed
  - **Open questions**: things that need human decision
  - **Next steps**: recommended follow-up tasks

---

## Quick Reference: Stack Hard Limits

| Layer | Technology | Known Ceiling |
|-------|-----------|---------------|
| DB | SQLite + Drizzle | Single-writer; ~100k rows before query planning matters |
| Vectors | In-process SQLite vecs | RAM proportional; plan for external store at scale |
| Realtime | Socket.IO (single node) | ~10k concurrent; needs Redis adapter for multi-instance |
| LLM routing | Single gateway (NestJS) | No queue/backpressure today |
| Build | Turborepo (local cache) | Slow CI without remote cache |
| Files | Local VFS (disk) | No lifecycle policy; unbounded growth |

## Quick Reference: Project Conventions Checklist

- [ ] All shared types in `packages/@kalio/types/src/index.ts` only
- [ ] Zero `any` in non-test source
- [ ] Zero cross-module imports (only `@kalio/types` crosses boundaries)
- [ ] Zero empty catch blocks
- [ ] All files within per-type hard limits: controller/gateway ≤ 250, service ≤ 400, module ≤ 120, React component ≤ 350 (absolute ceiling 500 for anything else; tests exempt)
- [ ] All destructive tools have `requiresConfirmation: true`
- [ ] All new Socket.IO events declared in `SocketEvents` type
- [ ] All new features covered by at least one failing test before implementation
- [ ] Session log created in `docs/sessions/` after non-trivial task

## References

- [AGENTS.md](../../../AGENTS.md) — project conventions and forbidden patterns
- [copilot-instructions.md](../../copilot-instructions.md) — full stack and architecture description
- [chat-streaming-tools-architecture.md](../../../docs/chat-streaming-tools-architecture.md) — event flow details
- [tool-architecture.md](../../../docs/tool-architecture.md) — tool system deep dive
- [database-schema-diagram.md](../../../docs/database-schema-diagram.md) — ERD
