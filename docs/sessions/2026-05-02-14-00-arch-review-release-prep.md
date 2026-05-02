# Architecture Review & Public Release Prep — 2026-05-02

**Scope:** Full codebase audit, secrets scan, docs cleanup, public repo preparation  
**Date:** 2026-05-02

---

## What was done

1. **Secrets scan** — confirmed `.env` and `.env.test` are not tracked by git. Only `.env.example` is committed (contains placeholder values only, no real keys).
2. **Polish language audit** — scanned all tracked `.ts/.tsx/.md/.jsx` files for Polish characters. Source code files flagged were false positives (emoji characters garbled in terminal output). Actual Polish content found in:
   - `.env.example` — comments translated to English
   - Docs removed (see below)
3. **Outdated docs removed** (`git rm`):
   - `docs/COMPARISON_PORTAL.md` — internal comparison with a different project
   - `docs/COMPARISON_V1_V2.md` — v1 vs v2 migration notes, irrelevant post-rewrite
   - `docs/GAP_ANALYSIS_V1_V2.md` — ditto
   - `docs/MVP_TRACKER.md` — stale tracker (last updated 2026-04-21, status no longer accurate)
   - `docs/kalio-v2-mvp-spec.md` — internal spec that predates the implementation
   - `docs/kalio-v2-tdd-plan.md` — superseded by `AGENTS.md` and `CONTRIBUTING.md`
   - `docs/kalio-v2-data-models.md` — superseded by actual schema + `database-schema-diagram.md`
   - `docs/kalio_v2_erd.html` — generated artifact, not source
   - `docs/mockup/kalio-tycoon.jsx` — prototype throwaway
   - `docs/spec/spec-pod-streming.md` — Polish-only spec, superseded by implementation
   - `docs/spec/Zobacz jak na github...` — Polish research note, not useful publicly
4. **`.env.example`** rewritten in English: removed Polish comments, removed duplicate `LLM_API_KEY` blocks, removed undocumented `xiaomimimo` provider, added `IMAGE_API_KEY` section.
5. **README.md** overhauled: accurate module list (CLIAgentModule, ImageModule added), correct roadmap (checked items reflect reality), updated architecture diagram, removed demo GIF placeholder, added proper Contributing + Roadmap + Code of Conduct links.
6. **`CODE_OF_CONDUCT.md`** created (Contributor Covenant 2.1 adapted).
7. **`CONTRIBUTING.md`** created: setup guide, TDD workflow, architecture rules table, tool registration pattern, Socket.IO event convention, PR checklist, session log instructions.

---

## Architecture Quality Assessment

### RAG Ratings

| Axis | Rating | Notes |
|---|---|---|
| **Module Isolation** | 🟢 Good | All cross-module comms via `@kalio/types`. ChatModule correctly imports VFSModule + ToolModule. One circular dep: `tool-registry ↔ subagent.tool` — tracked in audit. |
| **Type Contract Health** | 🟡 Watch | `@kalio/types/src/index.ts` is **675 LOC** — already past the 500 LOC split threshold. Not yet a God File but needs splitting by domain (chat, tool, vfs, raapp, etc.) before next major feature. |
| **Scalability Ceilings** | 🟡 Watch | SQLite single-writer lock will serialize concurrent sessions at scale. In-process sqlite-vec is RAM-bound. VFS files accumulate with no TTL/cleanup. All acceptable for single-user local-first use. |
| **Security Posture** | 🟡 Watch | RA-App `window.parent.postMessage` origin not validated (FE). MCP tools are globally registered, not persona-scoped. No rate limiting on `chat:send`. LLM credentials stored in DB without encryption (known post-MVP gap). |
| **Frontend State Coherence** | 🟢 Good | Session isolation fixed (2026-05-01). Streaming chunks properly scoped by `chunkSessionId`. Zustand `.getState()` used correctly in Socket.IO callbacks. `streamingChunks` pruned on finalizeChunk. |
| **Test Coverage** | 🟡 Watch | Unit test count high (92+). Known failing suite: `raapp.service.spec.ts` (7 failures, missing ConfigService mock — pre-existing, do not fix unless asked). No coverage numbers available without running the full suite. |
| **Observability** | 🟢 Good | `audit_log` table captures all significant operations. Health endpoint available. NestJS logger used consistently (not raw console). |

### 🔴 Critical items from audit (2026-05-02-report.md)

11 files exceed the hard LOC limit:

| File | Lines | Limit |
|---|---|---|
| `packages/@kalio/types/src/index.ts` | 675 | 400 |
| `apps/kalio-web/src/features/chat/ChatInterface.tsx` | 634 | 350 |
| `apps/kalio-web/src/features/settings/EmbeddingsPanel.tsx` | 507 | 350 |
| `apps/kalio-api/src/modules/raapp/raapp-versioning.service.ts` | 499 | 400 |
| `apps/kalio-api/src/modules/image/image-generation.service.ts` | 468 | 400 |
| `apps/kalio-web/src/features/settings/LLMPanel.tsx` | 424 | 350 |
| `apps/kalio-web/src/features/observability/ObservabilityPage.tsx` | 411 | 350 |
| `apps/kalio-web/src/features/memory/MemoryPage.tsx` | 401 | 350 |
| `apps/kalio-web/src/features/chat/ToolCallBubble.tsx` | 388 | 350 |
| `apps/kalio-web/src/features/settings/PersonasPanel.tsx` | 378 | 350 |
| `apps/kalio-web/src/features/settings/ImageSettingsPanel.tsx` | 377 | 350 |

Also flagged: 1 silent catch in `LLMPanel.tsx:147` (`.catch(() => null)`), 1 circular dependency (`tool-registry ↔ subagent.tool`), 9 unused exports in `kalio-web`.

### Prioritized actions before next feature

1. **Split `@kalio/types/src/index.ts`** into domain sub-files with barrel `index.ts` — prevents God File growth
2. **Fix silent catch** in `LLMPanel.tsx:147` — replace with typed error result or console.error
3. **Break circular dep** `tool-registry ↔ subagent.tool` — extract shared interface to `@kalio/types`
4. **Split `ChatInterface.tsx`** (634 LOC) — extract streaming logic and tool bubble rendering
5. **Origin validation** on `window.parent.postMessage` in `HtmlIframeRenderer`

---

## Files touched

- `README.md` — rewritten
- `.env.example` — translated to English, cleaned up
- `CODE_OF_CONDUCT.md` — created
- `CONTRIBUTING.md` — created
- `docs/sessions/2026-05-02-14-00-arch-review-release-prep.md` — this file
- 11 docs files removed (git rm)

---

## Open questions

- Should sessions logs be kept in the public repo? They contain no secrets but show development history. Current decision: keep — they are useful context for contributors.
- When to split `@kalio/types`? Suggested trigger: next time a new domain (e.g. auth, multi-user) is added.
- Image API credentials: currently stored plain in DB alongside LLM credentials. Should be encrypted at rest for any multi-user deployment.

---

## Next steps

- Fix the 5 priority items listed above
- Add GitHub Actions CI (typecheck + test) before public release
- Record a demo GIF for README
- Tag v0.1.0 once CI is green
