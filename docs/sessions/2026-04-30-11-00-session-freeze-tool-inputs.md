# 2026-04-30 — Session Freeze Bug Fix + Tool Input Display

## What was done

### Bug: Chat freezes after navigating home and back

**Root cause** — Two compounding issues:

1. `ChatInterface` was conditionally rendered in `App.tsx` (`{activeSection === 'talk' && ...}`). Navigating to landing **unmounted** it, deregistering all socket listeners. On return (remount), the `activeSessionId` effect fired again and called `clearAgentTurns()` even though the session hadn't changed — wiping any in-flight streaming turn. Subsequent `chat:chunk` events found `activeTurnId = null` and `addTurnItem` was never called, making the LLM response invisible.

2. `setActiveSession` in the store didn't clear `agentTurns`/`activeTurnId`, which meant switching sessions left ghost turns from the old session until the effect cleaned them up.

**Fix — two layers:**
- `sessionStore.ts`: `setActiveSession` now clears `agentTurns` and `activeTurnId` immediately on session switch
- `ChatInterface.tsx`: removed `clearAgentTurns()` from the activation effect (it runs on every mount, including remounts — this was the destructive part)
- `App.tsx`: talk section changed from `{activeSection === 'talk' && <div>...}` to `<div className={activeSection !== 'talk' ? 'hidden' : ''}>` — ChatInterface now stays mounted, preserving socket listeners and streaming state across navigation

### Feature: Show tool input args in completed tool call bubbles

`HistoryToolCallBubble` previously only showed the tool result. Added optional `args?: Record<string, unknown>` prop — when provided, shows an "input" section above the result in the expandable chip.

`AgentTurnBubble` now builds a `toolArgsByCallId` map from:
- Assistant messages' `toolCalls[].args` (persisted history)
- Current-turn `toolActivities.args` (live state, not yet in DB)

And passes the args to `HistoryToolCallBubble`.

## Files touched
- `apps/kalio-web/src/store/sessionStore.ts` — `setActiveSession` clears agentTurns/activeTurnId
- `apps/kalio-web/src/features/chat/ChatInterface.tsx` — removed clearAgentTurns from activation effect, updated dep array
- `apps/kalio-web/src/App.tsx` — CSS hide instead of conditional render for talk section
- `apps/kalio-web/src/features/chat/ToolCallBubble.tsx` — `HistoryToolCallBubble` adds `args` prop + display
- `apps/kalio-web/src/features/chat/AgentTurnBubble.tsx` — builds toolArgsByCallId, passes to HistoryToolCallBubble
- `apps/kalio-web/src/store/sessionStore.test.ts` — 3 new regression tests
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx` — 2 new regression tests + refactored clearAgentTurns mock to named variable
- `apps/kalio-web/src/features/chat/ToolCallBubble.test.tsx` — 4 new tests for args display

## Test results
193/193 passed. TypeScript clean.

## Open questions / next steps
- Tool inputs in `LiveToolCallBubble` are already shown (expandable) — no change needed there
- If the user wants args shown without requiring the expand click, consider making chips default-open when there are args
