# Session: Fix chat history bubble grouping

**Date**: 2026-05-02  
**Topic**: Fix scrambled message bubbles in chat history

## Problem

After a session reload (or reconnect) the chat looked broken:
- User messages and tool-call bubbles appeared out of order
- Earlier user messages jumped above agent tool results
- The "Interactive Q&A" conversation (multiple RA-App turns) was the clearest reproduction

## Root Cause

`buildTurnsFromHistory` in `chatUtils.ts` created **one `AgentTurn` per assistant message**.

A single agent cycle (one user message → agent finishes) can require multiple LLM iterations:
```
user → assistant(think+tool) → tool_result → assistant(think+tool) → tool_result → assistant(text)
```
That's 3 assistant messages for 1 user message → 3 `AgentTurn` objects.

The timeline renderer pairs by index:
```js
for (let i = 0; i < maxLen; i++) {
  push(userMsgs[i]);    // userMsgs[1] showed up after agentTurns[0] (wrong cycle!)
  push(agentTurns[i]);
}
```
With 3 turns and 1 user message, `maxLen=3`, so user messages at index 1 and 2 got
pulled from **the next conversation cycles** and placed after the first iteration's turn.
The result: user messages appeared at the top, bubbles mixed.

## Fix

`buildTurnsFromHistory` now groups all consecutive assistant messages between two user
messages into a **single `AgentTurn`** — mirroring the live streaming behaviour where
`startAgentTurn` opens one turn and multiple iterations append to it.

- **File changed**: `apps/kalio-web/src/features/chat/chatUtils.ts`
- Algorithm: accumulate items from consecutive assistant messages; flush to a new turn
  each time a `user` message is encountered (and once at end for the trailing cycle).

## Tests

**4 new regression tests** in `chatUtils.spec.ts`:

1. `REGRESSION: consecutive assistant messages (same agent cycle) are grouped into ONE turn`
2. `REGRESSION: multi-cycle conversation produces exactly N turns for N user messages`
3. `REGRESSION: items within a grouped turn preserve iteration order (think→tool→think→text)`

**1 test updated** (description + assertion corrected to match new semantics):
- `creates one turn per agent cycle` (was: `creates one turn per assistant message`)

**1 test updated** (scenario clarified):
- `turn id is deterministic and unique per turn index` — now uses two turns separated by a user message

All 265 web tests pass, tsc clean.

## Architecture note

The `buildTurnsFromHistory` → `setAgentTurns` path is used both on session load
and on socket reconnect. Both paths are now correct.

The live streaming path was already correct (one `AgentTurn` per `agent:start` event).
