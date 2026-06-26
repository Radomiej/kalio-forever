# Test gap detection: pending host-session rollback

- [x] Review automation memory, current diff, and repo test patterns.
- [x] Check current official testing guidance for Vitest and Playwright.
- [x] Narrow scope to a single changed path with missing regression coverage.
- [x] Add focused regression tests for pending host-session rollback and local pending-session merge preservation.
- [x] Run the smallest relevant frontend test target and confirm the new cases pass.
- [x] Record verification evidence and residual risk.

## Scope

Current architecture affected by this slice:

```mermaid
flowchart LR
  BTN["SessionPanel new-session button"] --> START["startPendingSessionFromPanel"]
  START --> PENDING["createPendingHostSession"]
  START --> STORE["sessionStore active/messages/turns"]
  START --> API["createAndActivateEmptyHostSession -> POST /api/sessions"]
  API --> OK["server session replaces pending shell"]
```

Target architecture after this slice:

```mermaid
flowchart LR
  BTN["SessionPanel new-session button"] --> START["startPendingSessionFromPanel"]
  START --> PENDING["optimistic pending host shell"]
  START --> API["POST /api/sessions"]
  API --> OK["resolved server session becomes active"]
  API --> FAIL["request rejects"]
  FAIL --> CLEAN["pending shell removed"]
  CLEAN --> RESTORE["previous active session restored"]
```

Models and relations touched by the changed code:

```mermaid
classDiagram
  class ChatSession {
    id: string
    personaId: string
    title: string
  }
  class SessionPanel
  class PendingHostSession
  class SessionStore

  SessionPanel --> PendingHostSession : creates
  SessionPanel --> SessionStore : updates
  PendingHostSession --> ChatSession : temporary instance
  SessionStore --> ChatSession : active/messages/turns
```

## Notes

- Narrowed to `apps/kalio-web/src/features/sessions/sessionPanelCreateSession.ts` and `SessionPanel.tsx`.
- The current diff adds optimistic pending-host creation and tests the success path, but not the rejection path that should roll back UI state.
- Kept the main slice in frontend regression coverage and added one backend guard regression for the new `run_subagent` repeat-prevention branch because that logic changed in the same working diff and had no follow-up test.

## Verification

- `corepack pnpm --filter kalio-web exec vitest run src/features/sessions/SessionPanel.test.tsx --testNamePattern "restores the previous active session when pending New Chat creation fails"`
- `corepack pnpm --filter kalio-web exec vitest run src/features/sessions/SessionPanel.test.tsx`
- `corepack pnpm --filter kalio-web exec vitest run src/features/sessions/mergeSessionsPreservingLocal.test.ts src/features/sessions/SessionPanel.test.tsx`
- `corepack pnpm --filter kalio-api exec vitest run src/modules/llm/providers/mock.provider.spec.ts --testNamePattern "stops repeating deterministic run_subagent after the child HITL tool result exists"`
- `corepack pnpm --filter kalio-api exec vitest run src/modules/llm/providers/mock.provider.spec.ts`

## Residual risk

- `apps/kalio-api/src/modules/chat/chat.gateway.event-routing.ts` still has no direct unit test for the actionable-event table or malformed payloads; current coverage is indirect through gateway tests.
