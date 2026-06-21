# Working Tree Review Runtime Slice

- [x] Confirm review target: current working tree diff against `HEAD` on `codex/mvp-prep`.
- [ ] Dispatch parallel review agents:
  - backend/runtime + API diff review
  - frontend/runtime + session panel diff review
- [ ] Run orchestrator pass on hotspot files, contracts, and tests.
- [ ] Check security-sensitive diff surfaces and runtime contract regressions.
- [ ] Summarize findings, verification evidence, and remaining gaps.

## Current Architecture

```mermaid
flowchart LR
  A["ChatGateway lifecycle events"] --> B["runtime status + session tree preload"]
  B --> C["session:status and session:runtime_snapshot"]
  C --> D["agentStore runtime merge"]
  D --> E["Chat / Canvas / SessionPanel / Graph / Home"]
  E --> F["user-visible lifecycle state"]
```

## Target Architecture

```mermaid
flowchart LR
  A["Changed runtime/watchlist slice"] --> B["backend snapshot batching + watchlist endpoints"]
  B --> C["frontend watch registry + bootstrap hydration"]
  C --> D["agentRuntime selectors / mutators / projections"]
  D --> E["virtualized SessionPanel + runtime surfaces"]
  E --> F["faster replay without state loss or stale child state"]
```

## Models

```mermaid
erDiagram
  ChatSession ||--o{ RuntimeActivitySnapshot : projects
  RuntimeActivitySnapshot ||--o{ RuntimeToolActivity : includes
  RuntimeActivitySnapshot ||--o{ RuntimeChildExecution : includes
  RuntimeActivitySnapshot ||--o| RAAppLaunchIntent : may_carry
  AgentStore }o--|| RuntimeActivitySnapshot : hydrates
  SessionWatchRegistry }o--o{ ChatSession : tracks
```

## Notes

- Review assumption: "ostatnie zmiany" means the unstaged and untracked working tree changes visible in `git status`.
- If that assumption is wrong and the target should be the last commit range instead, the review scope needs to be rerun against that exact diff.
