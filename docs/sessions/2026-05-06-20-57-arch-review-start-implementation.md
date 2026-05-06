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
- `.env.example`
- `README.md`
- `apps/kalio-web/src/features/settings/LLMPanel.tsx`
- `apps/kalio-web/src/features/settings/LLMPanel.test.tsx`
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

## Next Steps

1. Extend the same at-rest encryption boundary to remaining stored secrets, especially embedding credentials and any search-provider API key persisted via settings.
2. Migrate existing `requiresConfirmation: true` mutators to `ConfirmedTool` for consistency, even where policy is already correct.
3. Decide whether `session:identify` should stay trust-based or move behind a stronger session/auth model.
4. Tackle the next architecture hotspots from the review: oversized files and backend module boundary drift.
