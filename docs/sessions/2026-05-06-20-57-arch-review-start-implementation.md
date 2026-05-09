# Session: Architecture Review Follow-up — Initial Implementation

**Date**: 2026-05-06  
**Topic**: First implementation batch after architecture review

## What Was Reviewed

This session implemented the first high-priority fixes from the architecture review with focus on:
- tool confirmation/session ownership correctness on the backend
- destructive/mutating tool confirmation policy
- frontend quality issues called out in review (`any`, silent catch, empty catch)

## Key Findings

- `tool:confirm` / `tool:cancel` were not guarded like `raapp:approve`, so confirmations were weaker than the rest of the HITL boundary.
- Pending tool confirmations were keyed only by `requestId`; session binding needed to be enforced in the dispatch layer too.
- `kv_write` and `kv_delete` mutated persistent session state without `requiresConfirmation: true`.
- `LLMPanel` swallowed non-JSON error bodies during provider test failures.
- `useContextUsage.ts` and `AllowedPathsPanel.tsx` still contained non-test source issues flagged in review (`any`, window cast, empty catch).

## What Was Done

### Backend

**`apps/kalio-api/src/modules/chat/chat.gateway.ts`**
- Added session ownership guards for `tool:confirm` and `tool:cancel`, matching the existing RA-App approval pattern.
- Rejected confirm/cancel requests when the socket does not own the provided session.

**`apps/kalio-api/src/modules/chat/tool-dispatch.service.ts`**
- Bound pending confirmations to `sessionId` in addition to `requestId`.
- `resolveConfirmation()` and `cancelConfirmation()` now optionally enforce session matching.

**`apps/kalio-api/src/modules/tool/tools/kv.tools.ts`**
- Changed `kv_write` and `kv_delete` to `requiresConfirmation: true`.

**`apps/kalio-api/src/modules/tool/tools/image-generate.tool.ts`**
- Changed `image_generate` to `requiresConfirmation: true` because it writes generated files into VFS.

**`apps/kalio-api/src/modules/tool/tools/image-edit.tool.ts`**
- Changed `image_edit` to `requiresConfirmation: true` because it writes edited files into VFS.

**`apps/kalio-api/src/modules/tool/tools/skill.tools.ts`**
- Changed `skill_create` to `requiresConfirmation: true` to align create/update/delete of persistent skill configuration.

**`apps/kalio-api/src/modules/tool/tools/persona.tools.ts`**
- Changed `persona_create` to `requiresConfirmation: true` to align create/update/delete of persistent persona configuration.

**`apps/kalio-api/src/modules/credentials/credentials.service.ts`**
- Added transparent at-rest encryption for stored LLM credential API keys.
- Kept reads backward-compatible with legacy plaintext rows while decrypting for runtime use only.
- Required `CREDENTIALS_MASTER_KEY` in production and used a dev/test fallback key outside production.

**`apps/kalio-api/src/modules/image/image-config.service.ts`**
- Added transparent at-rest encryption for the stored image provider API key inside `image_config`.
- Preserved public config responses without exposing the secret and kept legacy plaintext rows readable.

**`apps/kalio-api/src/common/decorators/tool.decorator.ts`**
- Added a generic `ConfirmedTool` wrapper decorator so mutating tools can opt into HITL confirmation without repeating `requiresConfirmation: true` manually.

**`apps/kalio-api/src/modules/tool/tools/memory.tools.ts`**
- Changed `memory_ingest` and `memory_ingest_conversation` to require confirmation because they write long-term memory state.

**`apps/kalio-api/src/modules/tool/tools/raapp.tools.ts`**
- Changed `raapp_create` to require confirmation because it persists generated RA-App archives to storage.

**`apps/kalio-api/src/modules/credentials/credentials.service.ts`**
- Wrapped credential secret decryption behind safe logging/null-return paths so malformed encrypted values no longer crash reads, active-provider resolution, or model listing.
- Added explicit logging for model-fetch failures instead of silently returning an empty list.

**`apps/kalio-api/src/modules/image/image-config.service.ts`**
- Preserved the existing encrypted image API key on partial updates instead of decrypting and re-encrypting it unnecessarily.
- Added explicit logging for malformed stored image secrets and malformed persisted config during update.

**`apps/kalio-web/src/features/settings/LLMPanel.tsx`**
- Replaced the remaining non-fatal empty catch in `refreshBackendConfig()` with contextual error logging.

**`apps/kalio-api/src/common/utils/local-llm-provider.util.ts`**
**`apps/kalio-web/src/features/settings/llm-provider-settings.ts`**
- Added sync comments documenting the intentional duplication in local-provider detection until it can move to a shared runtime-safe package.

### Frontend

**`apps/kalio-web/src/features/settings/LLMPanel.tsx`**
- Replaced silent error parsing with explicit `Response` error handling.
- Preserved plain-text provider test errors as `HTTP <status>: <body>`.
- Limited JSON parsing to JSON responses only, reducing console noise.

**`apps/kalio-web/src/features/chat/hooks/useContextUsage.ts`**
- Removed real `any` usage from the Zustand selector and tool mapping.

**`apps/kalio-web/src/features/settings/AllowedPathsPanel.tsx`**
- Replaced `window as any` directory picker access with a typed local interface.
- Replaced empty catch with explicit AbortError handling and user-facing error fallback.

**`apps/kalio-web/src/features/raapp/HtmlIframeRenderer.tsx`**
- Replaced the empty catch inside the injected resize bridge with contextual `console.error` logging.

## Tests Added / Updated

**Backend**
- `apps/kalio-api/src/modules/chat/__tests__/chat.gateway.spec.ts`
  - added regression coverage for rejecting `tool:confirm` / `tool:cancel` when the socket does not own the session
  - added positive coverage for owned-session confirm/cancel

- `apps/kalio-api/src/modules/chat/__tests__/tool-dispatch.service.spec.ts`
  - added regression coverage for ignoring confirmation/cancellation attempts from the wrong session

- `apps/kalio-api/src/modules/tool/tools/kv.tools.spec.ts`
  - added regression coverage asserting `kv_write` and `kv_delete` require confirmation

- `apps/kalio-api/src/modules/tool/tools/image-generate.tool.spec.ts`
  - added regression coverage asserting `image_generate` requires confirmation because it writes to VFS

- `apps/kalio-api/src/modules/tool/tools/image-edit.tool.spec.ts`
  - added regression coverage asserting `image_edit` requires confirmation because it writes to VFS

- `apps/kalio-api/src/modules/tool/tools/skill.tools.spec.ts`
  - added regression coverage asserting `skill_create` requires confirmation

- `apps/kalio-api/src/modules/tool/tools/persona.tools.spec.ts`
  - added regression coverage asserting `persona_create` requires confirmation

- `apps/kalio-api/src/modules/credentials/credentials.service.spec.ts`
  - added regression coverage asserting stored LLM API keys are encrypted at rest while `getApiKey()` and active config still return the original secret

- `apps/kalio-api/src/modules/image/image-config.service.spec.ts`
  - added regression coverage asserting the image provider API key is not stored as plaintext in `app_settings`

- `apps/kalio-api/src/modules/tool/tools/memory.tools.spec.ts`
  - added regression coverage asserting `memory_ingest` and `memory_ingest_conversation` require confirmation

- `apps/kalio-api/src/modules/tool/tools/raapp-create.tools.spec.ts`
  - added regression coverage asserting `raapp_create` requires confirmation because it persists generated apps

- `apps/kalio-api/src/modules/credentials/credentials.service.spec.ts`
  - added regression coverage for malformed encrypted credentials returning `null` instead of crashing
  - added regression coverage for logging model-fetch failures instead of failing silently

- `apps/kalio-api/src/modules/image/image-config.service.spec.ts`
  - added regression coverage asserting partial config updates preserve the existing encrypted image apiKey value

- `apps/kalio-web/src/features/settings/LLMPanel.test.tsx`
  - added regression coverage asserting backend-config refresh failures are logged as non-fatal after activation

**Frontend**
- `apps/kalio-web/src/features/settings/LLMPanel.test.tsx`
  - added regression test for plain-text provider test failures (non-JSON response body)
  - extended `mockFetch()` helper to return raw `Response` objects when needed

- `apps/kalio-web/src/features/raapp/HtmlIframeRenderer.test.tsx`
  - added regression coverage asserting the injected resize bridge logs failures instead of swallowing them silently

## Test Results

### Backend focused batch
- `chat.gateway.spec.ts` — passing
- `tool-dispatch.service.spec.ts` — passing
- `kv.tools.spec.ts` — passing
- `image-generate.tool.spec.ts` — passing
- `image-edit.tool.spec.ts` — passing
- `skill.tools.spec.ts` — passing
- `persona.tools.spec.ts` — passing
- Combined backend confirmation-policy batches: 81 tests passing across focused runs

### Backend secret-storage batch
- `credentials.service.spec.ts` — passing
- `credentials-edge-cases.spec.ts` — passing
- `image-config.service.spec.ts` — passing
- Combined secret-storage batch: 48 tests passing

### Backend confirmation-wrapper batch
- `memory.tools.spec.ts` — passing
- `raapp-create.tools.spec.ts` — passing
- Combined confirmation-wrapper batch: 35 tests passing

### Review-followup batch
- `credentials.service.spec.ts` — passing
- `image-config.service.spec.ts` — passing
- `LLMPanel.test.tsx` — passing
- `credentials-edge-cases.spec.ts` — passing
- Combined review-followup validation: 52 tests passing across focused runs

### Frontend focused batch
- `LLMPanel.test.tsx` — passing
- `HtmlIframeRenderer.test.tsx` — passing
- Final focused frontend batch: 33 tests passing

### Editor validation
- No language-service errors on touched backend files
- No language-service errors on touched frontend files

## Files Touched

- `apps/kalio-api/src/modules/chat/chat.gateway.ts`
- `apps/kalio-api/src/modules/chat/tool-dispatch.service.ts`
- `apps/kalio-api/src/modules/chat/__tests__/chat.gateway.spec.ts`
- `apps/kalio-api/src/modules/chat/__tests__/tool-dispatch.service.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/kv.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/kv.tools.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/image-generate.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/image-generate.tool.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/image-edit.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/image-edit.tool.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/skill.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/skill.tools.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/persona.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/persona.tools.spec.ts`
- `apps/kalio-api/src/modules/credentials/credentials.service.ts`
- `apps/kalio-api/src/modules/credentials/credentials.service.spec.ts`
- `apps/kalio-api/src/modules/credentials/credentials-edge-cases.spec.ts`
- `apps/kalio-api/src/modules/image/image-config.service.ts`
- `apps/kalio-api/src/modules/image/image-config.service.spec.ts`
- `apps/kalio-api/src/config/env.schema.ts`
- `apps/kalio-api/src/common/decorators/tool.decorator.ts`
- `apps/kalio-api/src/modules/tool/tools/memory.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/memory.tools.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-create.tools.spec.ts`
- `apps/kalio-api/src/common/utils/local-llm-provider.util.ts`
- `.env.example`
- `README.md`
- `apps/kalio-web/src/features/settings/LLMPanel.tsx`
- `apps/kalio-web/src/features/settings/LLMPanel.test.tsx`
- `apps/kalio-web/src/features/settings/llm-provider-settings.ts`
- `apps/kalio-web/src/features/chat/hooks/useContextUsage.ts`
- `apps/kalio-web/src/features/settings/AllowedPathsPanel.tsx`
- `apps/kalio-web/src/features/raapp/HtmlIframeRenderer.tsx`
- `apps/kalio-web/src/features/raapp/HtmlIframeRenderer.test.tsx`

## Open Questions

- The socket/session ownership model is still implicitly trusted-localhost; there is still no real user/auth boundary for remote deployment.
- `session:identify` remains permissive by design; that is acceptable for local/single-user use, but not for a multi-user deployment model.
- The new at-rest encryption currently covers `credentials` and the image provider secret inside `image_config`, but not every stored secret yet.
- The production deployment path now depends on `CREDENTIALS_MASTER_KEY` being configured before stored secret reads/writes are exercised.
- Tool confirmation is now easier to apply consistently via `ConfirmedTool`, but older mutating tools still use the raw `Tool` decorator and can be migrated opportunistically.
- The timeout parsing review note is already obsolete: `TimeoutSettingsService` now validates stored values with a full-digit regex before parsing.
- Most of the older `LLMPanel` empty-catch review comments were already fixed before this pass; the last remaining non-fatal catch is now logged.

## Next Steps

1. Extend the same at-rest encryption boundary to remaining stored secrets, especially embedding credentials and any search-provider API key persisted via settings.
2. Migrate existing `requiresConfirmation: true` mutators to `ConfirmedTool` for consistency, even where policy is already correct.
3. Decide whether `session:identify` should stay trust-based or move behind a stronger session/auth model.
4. Tackle the next architecture hotspots from the review: oversized files and backend module boundary drift.

## Follow-up: audit, test-suite repair, README/docs cleanup

### Audit

- Ran `pnpm audit:report` from repo root.
- Latest report written to `docs/audit/2026-05-06-report.md`.
- Current static-analysis debt remains structural, not release-blocking:
  - 13 critical oversized files
  - 13 high-severity oversized/coupling findings
  - 1 circular dependency (`tool-registry.service.ts` ↔ `subagent.tool.ts`)
- No silent catches detected and no `any` hotspots reported.

### Test-suite fixes

- Repaired multiple stale spec harnesses after `ChatService` gained `CredentialsService` and after agent-loop semantics changed around empty no-tool retries.
- Updated backend specs for:
  - `chat.service.spec.ts`
  - `chat.service.event-ordering.spec.ts`
  - `chat-max-iterations.spec.ts`
  - `issues-verification.spec.ts`
  - `stream-processor.spec.ts`
  - `sessions.service.spec.ts`
  - `kv-store.service.spec.ts`
- Updated frontend specs for:
  - `sessionStore.test.ts`
  - `ToolCallBubble.spec.tsx`
  - `LandingPage.test.tsx`
- Removed noisy JSDOM network activity from `ToolCallBubble.spec.tsx` by mocking the subagent-history fetch.

### Final verification

- Final root run: `pnpm test`
- Result:
  - `kalio-api`: 93 files passing, 1073 tests passing
  - `kalio-web`: 29 files passing, 309 tests passing
  - repo overall green

### Documentation cleanup

- Simplified `README.md` with:
  - a short daily-use flow
  - success criteria after startup
  - a troubleshooting quick reference
  - a task-oriented "Where To Change Things" section
  - an explicit session-isolation statement in storage docs
- Updated `docs/chat-streaming-tools-architecture.md` to document:
  - session-bound `tool:confirm` / `tool:cancel`
  - pending confirmation ownership in `ToolDispatchService`
  - the generic confirmed-tool flow
- Removed redundant `docs/chat-message-flow.md` because the same flow already lives in `README.md`.

### Remaining debt after this batch

- Audit-driven large-file refactors were not attempted here; they are still the main cleanup backlog.
- Some web tests still print React `act(...)` warnings and expected error-path console output, but the suite is green and those warnings were not part of the requested bug-fix scope.

## Follow-up: review fixes, warning cleanup, and first sessionStore extraction

### What changed

- Re-checked the latest pasted review against current code instead of applying it blindly.
- Fixed the real session-scoped assertion drift in `apps/kalio-web/src/store/sessionStore.test.ts`.
- Added explicit tool-only done coverage in `apps/kalio-api/src/modules/chat/__tests__/stream-processor.spec.ts` to document that tool-only assistant iterations are persisted.
- Added named governance threshold constants plus rationale in `scripts/code-audit/run-audit.mjs` and documented those thresholds in `scripts/code-audit/README.md`.
- Reduced React `act(...)` warning noise in the warning-heavy `ChatInterface.test.tsx` slices by introducing async render/event helpers and converting the warning-producing tests to use them.
- Started the first real `sessionStore.ts` refactor slice by extracting pure session projection helpers into `apps/kalio-web/src/store/sessionStore.helpers.ts` without changing the store API.

### Validation

- `pnpm test -- src/modules/chat/__tests__/stream-processor.spec.ts` in `apps/kalio-api` — passing
- `pnpm test -- src/store/sessionStore.test.ts src/features/chat/ChatInterface.test.tsx` in `apps/kalio-web` — passing
- `pnpm audit:report` from repo root — passing, report regenerated

### Remaining note

- The targeted `ChatInterface.test.tsx` warnings were reduced for the touched blocks, but expected error-path console output still appears and broader warning cleanup remains a separate follow-up if you want the whole file normalized.
