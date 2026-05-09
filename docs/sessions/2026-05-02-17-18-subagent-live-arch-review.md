# Subagent Live Architecture Review

## What was reviewed

- Date: 2026-05-02 17:18 local time
- Scope: whether sub-agents are modeled as normal conversations, whether canvas can consume the normal live conversation stream, and whether the main difference versus a standard chat is only parent linkage plus end-of-run result packaging.

## Key findings

- Good: sub-agents are persisted as normal `ChatSession` rows with normal `ChatMessage` history and are retrievable through the same `/api/sessions/:id/messages` API as regular chats.
- Watch: live streaming is not session-broadcast based. Child-session events are emitted through the parent request's socket emitter, so they reach the initiating client but are not exposed as a generic session subscription channel.
- Watch: `CanvasPanel` does not render child chats from the ordinary live session stream. For non-active child sessions it loads transcript snapshots over REST and does not incrementally apply child `chat:chunk` events into per-session message history.
- Watch: sub-agent runtime is close to the normal chat loop but not identical. It skips `chat:context`, adds a dedicated focused sub-agent system prompt, and hardcodes `interlocutorLabel: 'Master agent'`.
- Good: the parent/master integration point is clean. `run_subagent` returns a typed `SubagentToolResult` that is persisted as a normal `tool_result` message in the parent session, so the parent sees a compact post-run payload rather than the child's raw transcript.

## Files reviewed

- `packages/@kalio/types/src/index.ts`
- `apps/kalio-api/src/modules/chat/chat.gateway.ts`
- `apps/kalio-api/src/modules/chat/chat.service.ts`
- `apps/kalio-api/src/modules/chat/session-pipeline.service.ts`
- `apps/kalio-api/src/modules/chat/session-manager.service.ts`
- `apps/kalio-api/src/modules/chat/sessions.service.ts`
- `apps/kalio-api/src/modules/chat/subagent-runtime.service.ts`
- `apps/kalio-api/src/modules/chat/tool-dispatch.service.ts`
- `apps/kalio-api/src/modules/chat/handlers/done.handler.ts`
- `apps/kalio-api/src/modules/tool/tools/subagent.tool.ts`
- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/CanvasPanel.tsx`
- `apps/kalio-web/src/store/sessionStore.ts`
- `packages/@kalio/sdk/src/index.ts`

## Open questions

- Should a child session be observable live by any client that opens that session, or only by the socket that triggered the parent turn?
- Should canvas become a true multi-session live viewer backed by per-session message state, or remain a lightweight preview with explicit `Open` navigation into the child chat?
- Should nested child sessions derive `interlocutorLabel` dynamically from the real parent agent identity instead of the current hardcoded label?

## Next steps

- If the product goal is "sub-agent = normal conversation + parent relationship", move from socket-local emit to session-scoped broadcast/subscription semantics.
- Add per-session live buffers in the frontend store so child `chat:chunk` events can update canvas transcript cards in real time.
- Keep the compact `SubagentToolResult` packaging for the parent session; it is the right boundary between full child transcript and parent-visible summary.