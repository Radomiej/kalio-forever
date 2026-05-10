# Session Log: Streaming bug hunt

**Date**: 2026-05-10 23:22  
**Branch**: feature/raapp-v2

## What was done

- Audited the chat streaming control path around `ChatGateway`, `ChatService`, `LLMServiceAdapter`, and `ChatInterface`.
- Added focused bug-reproduction tests that confirm current exploit/bug behavior without changing production code.
- Ran only the touched backend/frontend Vitest files to validate the reproductions.

## Confirmed findings

1. **Gateway session takeover**
   - `ChatGateway.handleChatSend()` auto-subscribes any socket to any claimed `sessionId` and forwards the payload to the session pipeline.
   - `handleSessionIdentify()` grants observation/control rights based only on a local socket map, not on authenticated session ownership.
   - After calling `session:identify`, a foreign socket can receive `chat:chunk` events and pass `tool:confirm` for that session.

2. **Abort does not reach upstream LLM stream**
   - `LLMServiceAdapter` starts `llm.streamChat()` fire-and-forget and has no cancellation channel.
   - Closing the async iterator stops local consumption only; the upstream provider can continue producing chunks/work after the turn has been aborted.

3. **Cross-session streaming state corruption in the web client**
   - `ChatInterface` still uses global `setStreaming(true/false)` in some event handlers.
   - A successful `tool:result` from a background session flips the active UI back into streaming mode even when the active session is different.

## Files touched

- `apps/kalio-api/src/modules/chat/__tests__/chat.gateway.spec.ts`
- `apps/kalio-api/src/modules/chat/__tests__/llm-service.adapter.spec.ts`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`

## Tests

- Backend:
  - `Push-Location apps/kalio-api; node_modules\.bin\vitest.cmd run src/modules/chat/__tests__/chat.gateway.spec.ts src/modules/chat/__tests__/llm-service.adapter.spec.ts; Pop-Location`
  - Result: passed
- Frontend:
  - `Push-Location apps/kalio-web; node_modules\.bin\vitest.cmd run src/features/chat/ChatInterface.test.tsx; Pop-Location`
  - Result: passed

## Decisions made

- Kept this slice as proof-only: tests document the behavior, no production fix applied.
- Grouped multiple gateway problems under one root cause: socket-local ownership with no real authorization boundary.

## Open questions / next steps

- If this app is expected to stay localhost-only and single-user, the gateway issue is still exploitable by any local webpage because the Socket.IO gateway allows `origin: '*'`; hardening scope depends on the intended deployment model.
- A real fix for abort propagation requires threading an abort/cancel signal through `ILLMSource`, `LLMService`, and provider implementations.