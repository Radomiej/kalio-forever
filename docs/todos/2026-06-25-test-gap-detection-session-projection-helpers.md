# 2026-06-25 Test Gap Detection: session projection helpers

- [x] Zawęzić zakres do świeżo zmienionego reconnect/session-projection slice.
  - Zakres: `apps/kalio-web/src/store/sessionStore.helpers.ts`
  - Powód: ostatni commit utwardził helpery pod częściowy stan runtime/testowy, ale ten fallback nie ma jeszcze testów bezpośrednich.
- [x] Dodać małe testy regresyjne dla null-safe fallbacków i odbudowy pending turna.
  - Cel: `resolveSessionSlice()` ma zwracać stabilny wynik nawet przy brakujących mapach store oraz ma odtwarzać aktywny turn z pending chunków.
- [x] Uruchomić skupioną weryfikację helpera oraz najbliższych reconnect/hydration suite.
  - Plan:
    - `corepack pnpm --filter kalio-web exec vitest run src/store/sessionStore.helpers.test.ts`
    - `corepack pnpm --filter kalio-web exec vitest run src/features/chat/historyHydration.test.ts src/features/chat/hooks/useChatSocketEvents.reconnect.test.ts`

## Acceptance

- `resolveSessionSlice()` nie rzuca wyjątkiem, gdy `sessionMessages`, `sessionAgentTurns`, `sessionActiveTurnIds`, `streamingChunks`, `thinkingChunks` lub `chunkSessionIds` są puste albo nieobecne w częściowym stanie.
- Jeśli dla sesji istnieją pending chunki, ale brak zapisanych `agentTurns`, helper odbudowuje tymczasowy aktywny turn z poprawnym `promptMessageId`.
- Zakres pozostaje lokalny dla helpera projekcji i jego bezpośrednich regresji reconnect/hydration.

## Current Architecture

```mermaid
flowchart LR
  HS["hydrateSessionHistoryIntoStore"] --> RS["resolveSessionSlice"]
  RS --> SM["sessionMessages/sessionAgentTurns"]
  RS --> CH["chunkSessionIds + streamingChunks"]
  CH --> PT["pending assistant text"]
  SM -->|missing maps| ERR["fragile partial-state access"]
```

## Target Architecture

```mermaid
flowchart LR
  HS["hydrateSessionHistoryIntoStore"] --> RS["resolveSessionSlice"]
  RS --> SM["null-safe session maps"]
  RS --> CH["pending chunk maps"]
  CH --> RT["restored active turn when persisted turn is absent"]
  SM --> OK["stable active projection after reconnect"]
```

## Models Affected

```mermaid
classDiagram
  class SessionProjectionState {
    activeSessionId
    messages
    sessionMessages
    streamingChunks
    thinkingChunks
    chunkSessionIds
    agentTurns
    sessionAgentTurns
    activeTurnId
    sessionActiveTurnIds
  }
  class ChatMessage {
    id
    sessionId
    role
    content
    thinking
    streaming
  }
  class AgentTurn {
    id
    sessionId
    promptMessageId
    items
    done
  }

  SessionProjectionState --> ChatMessage : resolves visible messages
  SessionProjectionState --> AgentTurn : resolves active turn
  AgentTurn --> ChatMessage : references pending message ids
```

## Notes

- Poprzedni przebieg automatu domknął rollback pending host-session; ten przebieg nie duplikuje tamtych testów.
- Najmniejszy sensowny punkt wejścia to test bezpośredni helpera, bo obecne suite przykrywają ten kod tylko pośrednio.

## Verification

- `corepack pnpm --filter kalio-web exec vitest run src/store/sessionStore.helpers.test.ts`
- `corepack pnpm --filter kalio-web exec vitest run src/features/chat/historyHydration.test.ts src/features/chat/hooks/useChatSocketEvents.reconnect.test.ts`

## Residual risk

- Backendowy `chat.gateway.event-routing` nadal wygląda na słabiej pokryty bezpośrednimi testami, ale ten przebieg celowo nie rozszerza zakresu poza frontendowy reconnect/session-projection slice.
