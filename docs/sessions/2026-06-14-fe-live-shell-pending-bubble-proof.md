# FE Live Shell Pending Bubble Proof

Date: 2026-06-14

## Result

- Fixed the FE live-shell regression where a tool-only active turn could suppress the optimistic assistant bubble before any user-facing text appeared.
- Kept the `New Chat` shell aligned with current React guidance: one explicit live-turn model instead of multiple contradictory booleans deciding whether the UI is still running.
- Demoted manual-stop `INTERRUPTED` logging from red `console.error` noise to neutral debug/group logging in both the FE socket hook and `@kalio/sdk`.
- Removed the last global `isStreaming` leaks from `CanvasPanel`, `RAAppRenderer`, and `ConversationManagerPanel`; those views now derive state from the session-scoped live-turn model or explicit runtime signals instead of a cross-session flag.
- Tightened the session renderability contract so legacy architecture placeholder branches do not surface as real conversations without transcript or live runtime evidence, while explicit `sessionSurface: 'conversation-branch'` still remains visible immediately.
- Added regression coverage for:
  - tool-only live turns preserving the optimistic pending bubble,
  - first-prompt stop visibility from the `New Chat` launch form,
  - `INTERRUPTED` and cancelled tool-result logging not surfacing as runtime errors,
  - session-scoped live-state behavior in canvas / RA-App / activity manager,
  - legacy placeholder branch hiding without regressing explicit conversation branches.

## Architecture Shape

```mermaid
flowchart LR
    Prompt["New Chat prompt submit"] --> Live["resolveLiveTurnState"]
    Live --> Pending["PendingAssistantBubble"]
    Live --> Turn["AgentTurnBubble"]
    Tools["Tool activity only"] --> Live
    Chunks["Thinking/text chunks"] --> Live

    Tools -. before fix: hid pending bubble .-> Pending
    Live -. after fix: tool-only is still live, not materialized text .-> Pending
```

## Verification

- Web research:
  - React state-structure guidance: [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure)
  - React shared ownership guidance: [Sharing State Between Components](https://react.dev/learn/sharing-state-between-components)
  - Socket reconnect guidance: [Connection state recovery](https://socket.io/docs/v4/connection-state-recovery/)
- Focused FE gate:
  - `corepack pnpm --filter kalio-web exec vitest run src/features/chat/liveTurnState.test.ts src/features/chat/ChatInterface.test.tsx`
  - `corepack pnpm --filter kalio-web exec vitest run src/store/agentStore.spec.ts src/features/chat/hooks/useChatSocketEvents.queued.test.ts`
  - `corepack pnpm --filter kalio-web exec vitest run src/features/chat/liveTurnState.test.ts src/features/chat/ChatInterface.test.tsx src/features/chat/hooks/useChatSocketEvents.reconnect.test.ts src/features/chat/hooks/useChatSocketEvents.queued.test.ts src/store/agentStore.spec.ts`
  - `corepack pnpm --filter kalio-web exec vitest run src/features/chat/liveTurnState.test.ts src/features/chat/ChatInterface.test.tsx src/services/kalioSdkLogging.test.ts src/store/agentStore.spec.ts src/features/chat/hooks/useChatSocketEvents.queued.test.ts`
  - `corepack pnpm --filter kalio-web exec vitest run src/features/sessions/sessionRenderableFilter.test.ts src/features/raapp/RAAppRenderer.test.tsx src/features/sessions/ConversationManagerPanel.test.tsx src/features/chat/CanvasPanel.test.tsx src/features/chat/liveTurnState.test.ts src/features/chat/ChatInterface.test.tsx`
  - `corepack pnpm --filter kalio-web exec tsc --noEmit`
  - `corepack pnpm --filter @kalio/sdk run typecheck`
- Manual browser proof on dev stack `http://127.0.0.1:5188`:
  - verified `pending-agent-bubble` appears after the first prompt from `New Chat`,
  - verified `chat-stop-btn` is visible in the same pre-chunk live state.
- Follow-up Playwright MCP browser pass on the current `5188` stack:
  - could reproduce `Talk -> New`,
  - but the live page manifest still did not expose the launch-form controls after clicking `New`,
  - so final demo proof remains blocked on a dev-stack restart or confirmation that the hot-reload stack is not serving stale UI.

## Evidence

- Playwright Orchestrator session: `edef1888-ba59-4bd6-87b7-79e5fdd5ec71`
- Snapshot artifact:
  - `C:\Projekty\mcp-playwrigh-master\.local-data\mcp-playwright-orchestrator\snapshots\edef1888-ba59-4bd6-87b7-79e5fdd5ec71--94a822ad-b2ef-4bdf-b511-1be42ac4e129--fe-shell-live-bubble-proof--document\2026-06-14T21-08-18-984Z-684b0acb-0735-4c23-8ecc-27b04c8ca9b6.png`

## Live Readiness

- The specific missing-pending-bubble regression is fixed and manually verified.
- The `INTERRUPTED` console-noise root cause is fixed in code and covered by regression tests.
- Demo readiness still needs one refreshed browser proof after this log cleanup so the artifact matches the code.

## Remaining Risk

- The Playwright evidence artifact predates the interrupt-log cleanup, so it cannot yet serve as the final clean proof.
- The current hot-reload `5188` stack may be stale or still partially regressed around `New Chat`; manual browser proof must be rerun after restart before calling the FE shell demo-ready.
- Follow-up workflow continuity and reload/reconnect should get one more real-browser pass before calling the FE shell done.
