# Browser MCP QA Skill

## Acceptance Criteria

- [x] Record the reliable QA path for Kalio when Playwright Orchestrator MCP and Chrome MCP are both available.
- [x] Capture the observed Chrome MCP localhost bootstrap failure as an explicit known limitation instead of tribal knowledge.
- [x] Define which scenarios require full Playwright E2E instead of exploratory browser MCP smoke.
- [x] Save the guidance in repo docs so future sessions can reuse it after refresh.

## Current Architecture

```mermaid
flowchart TD
  BrowserMcp["Browser MCP client"] --> RunningStack["Existing dev or QA stack"]
  RunningStack --> Web["Kalio web app"]
  Web --> Api["Kalio API"]
  PlaywrightOrch["Playwright Orchestrator MCP"] --> Web
  ChromeMcp["Chrome MCP"] --> Web
  E2E["Playwright E2E runner"] --> ManagedStack["Managed built QA stack"]
```

## Target Architecture

```mermaid
flowchart TD
  ReleaseGate["Release gate"] --> E2E["Playwright E2E on managed QA stack"]
  ExploratoryQa["Exploratory QA"] --> PlaywrightOrch["Playwright Orchestrator MCP"]
  ChromeDebug["Chrome-specific debugging"] --> ChromeMcp["Chrome MCP"]
  ChromeMcp --> FailureClass["Console/bootstrap failure evidence only when localhost API bootstrap breaks"]
  PlaywrightOrch --> VisualProof["Screenshots DOM console evidence"]
  E2E --> DurableProof["Repeatable chat/workflow reconnect hydration proof"]
```

## Models And Relations

```mermaid
erDiagram
  QaRun ||--o{ EvidenceArtifact : produces
  QaRun {
    string stackType
    string browserTool
    string url
    string result
  }
  EvidenceArtifact {
    string kind
    string location
    string scenario
  }
  ScenarioRule {
    string scenario
    string primaryTool
    string fallbackTool
  }
  QaRun }o--|| ScenarioRule : follows
```

## Notes

- 2026-06-22: Playwright Orchestrator MCP successfully opened the managed QA stack and verified the Kalio shell on `http://127.0.0.1:57583`.
- 2026-06-22: Chrome MCP opened the same stack but failed bootstrap API requests with repeated `AxiosError: Network Error`, so it is currently a debugging surface, not a reliable release gate for localhost Kalio on this machine.
- 2026-06-22: Full architecture workflow proof still belongs to Playwright E2E on a managed/built stack, not to exploratory MCP browsing alone.
