# 2026-05-12 01:46 - context hard limit and canvas image fix

## What was done

Closed two linked regressions:
- backend conversation requests were not enforcing the configured context window at all
- canvas rendered `image_generate` results as raw JSON/base64 and counted raw `tool_result` payloads in `~Tokens`

Implemented:
- added `llm-history.utils.ts` in chat backend for two responsibilities:
  - sanitize oversized tool results before they re-enter LLM history
  - compact LLM history against the configured backend `contextWindowSize` before every `llmSource.stream()` call
- `SessionManagerService.toLLMMessages()` now sanitizes `tool_result` content for LLM use, replacing inline `data:` blobs with short placeholders and truncating oversized strings
- `ChatService.handleTurn()` now reads `credentialsService.getContextWindowSize()` and compacts the effective history on every iteration of the agent loop before calling the model
- `CanvasPanel` now renders `image_generate` success payloads with `ImageResultRenderer` instead of `JSON.stringify(...)`
- `CanvasPanel` session token estimate now ignores raw `tool_result` payload bodies and fixes the warning/error threshold order

## Tests added/updated

Added regressions for:
- stripping inline image data URLs from persisted `tool_result` history before sending them back to the LLM
- compacting server-side history against configured context window before LLM streaming
- rendering `image_generate` results in canvas as an actual image preview
- preventing canvas token warnings from huge raw `tool_result` payloads

## Validation

Focused backend Vitest:
- `npm run test --prefix apps/kalio-api -- src/modules/chat/__tests__/session-manager.service.spec.ts src/modules/chat/__tests__/chat.service.spec.ts --run`

Focused frontend Vitest:
- `npm run test --prefix apps/kalio-web -- src/features/chat/CanvasPanel.test.tsx --run`

Static checks:
- `get_errors` on touched backend/frontend files returned no errors

## Files touched

- `apps/kalio-api/src/modules/chat/llm-history.utils.ts`
- `apps/kalio-api/src/modules/chat/session-manager.service.ts`
- `apps/kalio-api/src/modules/chat/chat.service.ts`
- `apps/kalio-api/src/modules/chat/__tests__/session-manager.service.spec.ts`
- `apps/kalio-api/src/modules/chat/__tests__/chat.service.spec.ts`
- `apps/kalio-web/src/features/chat/CanvasPanel.tsx`
- `apps/kalio-web/src/features/chat/CanvasPanel.test.tsx`

## Decisions

- Fixed the real enforcement path on the backend instead of trying to rely on frontend compaction state. Frontend trimming only mutates local UI state and cannot protect model requests.
- Kept raw tool result payloads persisted in chat history for UI rendering; only the LLM-facing conversion path is sanitized.
- Used approximate server-side token estimation with safety headroom rather than introducing a provider-specific tokenizer into the request path.

## Next steps

- Consider exposing backend compaction/sanitization metrics in audit logs so oversized-context incidents are easier to diagnose from the UI.
- If large RA-App/tool payloads still pressure context in practice, add a provider-visible summary field for truncated tool results instead of raw preview text.