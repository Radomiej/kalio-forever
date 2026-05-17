# Session: tool:arg_progress streaming indicator

**Date**: 2026-05-02  
**Status**: Complete — all typechecks green

## Problem

Between `agent:start` and `tool:start`, the frontend showed only a loading spinner with no feedback while the LLM was silently streaming tool call arguments (e.g. entire HTML for `raapp_create`). This was especially painful for large outputs.

## Solution

Added a `tool:arg_progress` Socket.IO event emitted ~once/second from the BE while the LLM streams tool arguments, showing chars written and chars/sec (5-second sliding window).

## Files Changed

### `packages/@kalio/types/src/index.ts`
- Added `'tool:arg_progress': { toolName: string; totalChars: number; charsPerSec: number; sessionId: ID }` to `SocketEvents`

### `packages/@kalio/sdk/src/index.ts`
- Added `ToolArgProgressHandler` type alias
- Added `onToolArgProgress(handler)` method to `KalioSDK`

### `apps/kalio-api/src/modules/llm/llm.types.ts`
- Added optional 7th param `onToolArgChunk?: (toolName: string, deltaChars: number) => void` to `ILLMProvider.streamChat()`

### `apps/kalio-api/src/modules/llm/llm.service.ts`
- Added same 7th param; passes through to `provider.streamChat()`

### `apps/kalio-api/src/modules/llm/providers/base-openai-compatible.provider.ts`
- Added `onToolArgChunk?` param to `streamChat()`
- After each `argsRaw += fn['arguments']`, calls `onToolArgChunk?.(toolCallBuffers[idx]!.name, fn['arguments'].length)`

### `apps/kalio-api/src/modules/chat/interfaces/llm-chunk.types.ts`
- Added `ToolArgProgressChunk { type: 'tool_arg_progress'; toolName; totalChars; charsPerSec }`
- Added to `InternalLLMChunk` union

### `apps/kalio-api/src/modules/chat/llm-service.adapter.ts`
- Added `makeToolArgRateTracker()` pure function: 5s sliding window, 1s emit interval
- Created tracker before `llm.streamChat()` call and passed as `onToolArgChunk`

### `apps/kalio-api/src/modules/chat/handlers/tool-arg-progress.handler.ts` _(NEW)_
- `ToolArgProgressHandler` implements `ChunkHandler<ToolArgProgressChunk>`
- Emits `tool:arg_progress` via `ctx.emit()`

### `apps/kalio-api/src/modules/chat/chat.module.ts`
- Registered `ToolArgProgressHandler` in providers and `CHUNK_HANDLERS` factory

### `apps/kalio-web/src/store/agentStore.ts`
- Added `toolArgProgress: { toolName; totalChars; charsPerSec } | null` to `AgentState`
- Added `setToolArgProgress(...)` action
- `clearToolActivities()` also clears `toolArgProgress`

### `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- Destructures `setToolArgProgress` from `useAgentStore`
- Subscribes to `eventBus.onToolArgProgress(...)` → calls `setToolArgProgress`
- In `onToolStart` handler: calls `setToolArgProgress(null)` (clears when tool actually fires)

### `apps/kalio-web/src/features/chat/AgentTurnBubble.tsx`
- Reads `toolArgProgress` from `useAgentStore`
- When `toolArgProgress != null` AND turn has no items yet: shows `"Writing raapp_create… 1,234 chars · 320/s"` instead of loading dots

## Architecture Decisions

- **Rate tracking in adapter, not provider** — provider calls callback naively on every SSE chunk; adapter handles windowing. Keeps providers simple.
- **5s sliding window, 1s emission** — smooth rate signal without flooding the socket
- **totalChars** accumulated per tool name (resets each tracker instance, i.e. per turn)
- **Mock provider unchanged** — optional 7th param, mock doesn't stream tool args via SSE
- **OpenAI-compatible subclass unchanged** — inherits from base

## Result

`pnpm turbo run typecheck` — all 6 tasks green, zero errors.
