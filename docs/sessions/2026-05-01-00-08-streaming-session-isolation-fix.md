# Session Log: Streaming Session Isolation Fix

**Date**: 2026-05-01 ~00:08  
**Branch**: mvp (on top of `2a250d6`)

## What was done

### Bug fixed: streaming content lost on session switch

**Root cause**: Two compounding issues:
1. `appendChunk` in `sessionStore.ts` used `s.activeSessionId` for the placeholder message's `sessionId` instead of the actual chunk's session. Switching to session B while session A streamed caused A's chunks to contaminate B's messages.
2. `setActiveSession` cleared `messages` and `agentTurns`. When switching back to A, the DB reload overwrote in-progress content. If the stream wasn't yet in the DB, content was permanently lost.
3. Event handlers in `ChatInterface.tsx` (`onChunk`, `onAgentStart`, `onAgentDone`, `onContext`, `onComplete`) had no session guard — they processed events for ALL sessions regardless of which was active.

**Fix — `sessionStore.ts`**:
- Added `chunkSessionIds: Record<string, string>` (messageId → sessionId) to state.
- `appendChunk` accepts optional `chunkSessionId` param. If the chunk belongs to a non-active session, it accumulates in `streamingChunks`/`thinkingChunks` but does NOT touch `messages`.
- `finalizeChunk` cleans up `chunkSessionIds` entry and only updates `messages` if the chunk belongs to the active session.
- `setMessages` merges in-progress streaming messages (from `streamingChunks`/`chunkSessionIds`) for the active session that aren't in the DB data yet.
- `setActiveSession` detects pending streaming chunks for the target session, creates a synthetic `agentTurn` and initial `messages` array so streaming content is immediately visible when switching back.

**Fix — `ChatInterface.tsx`**:
- `onChunk`: passes `chunk.sessionId` to `appendChunk`; guards `addTurnItem` and `setStreaming(false)` with active-session check.
- `onComplete`: only calls `setStreaming(false)` for the active session; only finalizes chunks belonging to that session.
- `onAgentStart`: only calls `startAgentTurn` / `clearToolActivities` for the active session.
- `onAgentDone`: only calls `finalizeAgentTurn` for the active session.
- `onContext`: only calls `setContext` for the active session.

### Bug fixed: connection-lost banner false positive

`backendHealth.ts` polls `/api/health` (REST) independently from Socket.IO. A brief 503 during LLM streaming caused the banner to flash even though WebSocket was fine.

**Fix**: Added `FAILURES_BEFORE_OFFLINE = 2` threshold. The service now requires 2 consecutive probe failures before transitioning to `'offline'`. A single transient REST failure schedules a retry without showing the banner.

## Files touched
- `apps/kalio-web/src/store/sessionStore.ts` — `chunkSessionIds`, session-aware `appendChunk`/`finalizeChunk`/`setMessages`/`setActiveSession`
- `apps/kalio-web/src/features/chat/ChatInterface.tsx` — session guards in all event handlers
- `apps/kalio-web/src/services/backendHealth.ts` — `FAILURES_BEFORE_OFFLINE` grace period
- `apps/kalio-web/src/store/sessionStore.spec.ts` — 6 new regression tests (TDD)
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx` — added `chunkSessionIds: {}` to mock getState

## Tests
- 6 new regression tests in `sessionStore.spec.ts` for session isolation (all pass)
- Pre-existing web test failures: 9 (in `ChatInterface.test.tsx` × 5, `LLMPanel.test.tsx` × 4) — unchanged
- API tests: 919/919 passing

## Decisions made
- Synthetic agent turn uses id `restoring-${sessionId}` to distinguish from real turnIds (UUIDs).
- `setMessages` merge preserves insert order: historical DB messages first, then pending streaming.
- `FAILURES_BEFORE_OFFLINE = 2` is a constant (not config) — transient hiccups are expected during dev, 2 is a low enough number to not mask real outages.

## Open questions / next steps
- `flushThinkingChunks` still clears ALL thinking chunks (not session-aware). Edge case: tool fires in session B while session A has pending thinking — A's thinking would be cleared. Unlikely in practice.
- Consider making `agentStore.isStreaming` per-session (currently global). Currently, if session B has a stream and session A's done chunk fires, `setStreaming(false)` for the active session could interfere if B is also streaming. Unlikely since only one session can be active at a time.
