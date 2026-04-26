# Chat Message Flow

How a user message travels through the system — from send to rendered UI.

## Architecture overview

```mermaid
flowchart TD
    subgraph FE ["Frontend (React)"]
        direction TB
        UI["ChatInput — user types & hits Send"]
        HS["handleSend()\naddMessage(userMsg)\nclearToolActivities()\neventBus.sendMessage(...)"]
        SS["sessionStore.messages\n(Zustand)"]
        AS["agentStore.toolActivities\n(Zustand)"]
        R["ChatInterface render\ngroupIntoTurns(messages)"]
        UB["MessageBubble\n(user role)"]
        AB["AgentTurnBubble\n(all consecutive non-user msgs\ngrouped into ONE card)"]
        TCB_live["LiveToolCallBubble\n(from agentStore — in-progress)"]
        TCB_hist["HistoryToolCallBubble\n(from tool_result message — done)"]
        RAR["RAAppRenderer\n(iframe / HTML / GUI)"]
    end

    subgraph BE ["Backend (NestJS + Socket.IO)"]
        direction TB
        GW["ChatGateway\nchat:send handler"]
        LLM["LLM stream\n(streamChat)"]
        DB[("SQLite DB\nmessages table")]
        TOOL["processToolCall()\ntoolDispatch.dispatch(...)"]
        LLM2["Follow-up LLM stream\n(after all tools)"]
    end

    UI -->|click Send| HS
    HS -->|addMessage| SS
    HS -->|socket emit 'chat:send'| GW

    GW -->|persist user msg| DB
    GW --> LLM

    LLM -->|"socket 'chat:chunk' (delta)"| FE_chunk["onChunk → appendChunk(msgId, delta)\nsessionStore creates streaming assistant msg"]
    LLM -->|"chunk.done=true"| FE_fin["finalizeChunk(msgId)\nsets streaming=false"]
    LLM -->|"socket 'chat:complete' #1"| FE_c1["onComplete → setStreaming(false)"]

    LLM -->|tool calls detected| TOOL

    TOOL -->|"socket 'tool:start'"| FE_ts["onToolStart\naddToolActivity(callId, toolName, 'running')\n→ agentStore"]
    TOOL -->|execute tool| TOOL_EXEC["tool handler\n(e.g. raapp_create)"]
    TOOL_EXEC -->|persist tool_result| DB
    TOOL -->|"socket 'tool:result'"| FE_tr["onToolResult\nupdateToolActivity(status)\naddMessage(tool_result ChatMessage)\nsetStreaming(true)"]

    TOOL -->|after all tools| LLM2
    LLM2 -->|"socket 'chat:chunk' (delta)"| FE_chunk
    LLM2 -->|"socket 'chat:complete' #2"| FE_c2["onComplete → setStreaming(false)"]

    FE_chunk --> SS
    FE_fin --> SS
    FE_tr --> SS
    FE_ts --> AS

    SS --> R
    AS --> R

    R -->|role='user'| UB
    R -->|"consecutive non-user\nmessages → one turn"| AB

    AB -->|"role='assistant' msg"| MD["MarkdownViewer"]
    AB -->|"role='tool_result' msg\n(history, done)"| TCB_hist
    AB -->|"live activities not yet\nin messages"| TCB_live

    TCB_hist -->|"type='html'/'gui'"| RAR
    TCB_live -->|"result.data is RAAppBlock"| RAR
```

## Socket event sequence (single tool call)

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant BE as Backend
    participant DB as SQLite

    FE->>BE: chat:send { sessionId, content, personaId }
    BE->>DB: INSERT user message
    BE->>BE: LLM stream (first pass)
    loop streaming chunks
        BE-->>FE: chat:chunk { messageId, delta }
    end
    BE-->>FE: chat:chunk { done: true, messageId }
    BE->>DB: INSERT assistant message (with toolCalls)
    BE-->>FE: chat:complete #1

    Note over FE: First assistant bubble finalized

    BE->>BE: processToolCall (e.g. raapp_create)
    BE-->>FE: tool:start { callId, toolName, args }
    Note over FE: addToolActivity → LiveToolCallBubble appears (spinner)

    BE->>BE: execute tool
    BE->>DB: INSERT tool_result message
    BE-->>FE: tool:result { callId, status, data }
    Note over FE: updateToolActivity → HistoryToolCallBubble replaces spinner<br/>addMessage(tool_result) → persists to message store

    BE->>BE: LLM stream (follow-up, with tool results in history)
    loop streaming chunks
        BE-->>FE: chat:chunk { messageId, delta }
    end
    BE-->>FE: chat:chunk { done: true, messageId }
    BE->>DB: INSERT follow-up assistant message
    BE-->>FE: chat:complete #2

    Note over FE: All messages grouped into one AgentTurnBubble
```

## Turn grouping (AgentTurnBubble)

`groupIntoTurns()` in `ChatInterface.tsx` walks `messages` and groups all consecutive non-user messages into a single **agent turn**:

```
messages = [user, assistant_A1, tool_result, assistant_A2, user, assistant_B1]

turns = [
  { type: 'user',  msg: user }
  { type: 'agent', msgs: [assistant_A1, tool_result, assistant_A2], isLast: false }
  { type: 'user',  msg: user }
  { type: 'agent', msgs: [assistant_B1], isLast: true }
]
```

`AgentTurnBubble` renders the agent turn:
1. **Thinking block** (collapsed) — from `thinkingChunks` across all assistant msgs in the turn
2. **Interleaved content** — assistant text via `MarkdownViewer`, tool_result messages via `HistoryToolCallBubble`
3. **Pending live activities** — `LiveToolCallBubble` for tools still running (from `agentStore`, not yet in messages)

`toolActivities` from `agentStore` are only passed to the **last** turn (the active one).

## Key files

| File | Responsibility |
|------|---------------|
| [features/chat/ChatInterface.tsx](../apps/kalio-web/src/features/chat/ChatInterface.tsx) | Socket wiring, turn grouping, rendering |
| [features/chat/AgentTurnBubble.tsx](../apps/kalio-web/src/features/chat/AgentTurnBubble.tsx) | Groups one agent turn into a single bubble |
| [features/chat/ToolCallBubble.tsx](../apps/kalio-web/src/features/chat/ToolCallBubble.tsx) | Renders a single tool invocation (live or history) |
| [features/chat/MessageBubble.tsx](../apps/kalio-web/src/features/chat/MessageBubble.tsx) | User message bubble |
| [store/sessionStore.ts](../apps/kalio-web/src/store/sessionStore.ts) | Messages array (append, stream chunks, finalize) |
| [store/agentStore.ts](../apps/kalio-web/src/store/agentStore.ts) | Live tool activities (cleared per turn) |
| [services/eventBus.ts](../apps/kalio-web/src/services/eventBus.ts) | KalioSDK socket wrapper |
