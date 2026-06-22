# FamilyQuest workflow runtime proof

## Status

- [x] Reproduce the real FamilyQuest workflow failure on the QA stack with a live LLM.
- [x] Trace the failure boundary through backend logs and launch/runtime contracts.
- [x] Unify workflow launch defaults between Talk launch and Architect launch.
- [x] Raise the shared non-executor fallback iteration budget for architecture slots.
- [ ] Rebuild the QA stack and rerun the real FamilyQuest workflow proof.
- [ ] Confirm finalizer completion, child transcript visibility, and normal chat stream on the rebuilt stack.

## Current architecture

```mermaid
flowchart TD
  Talk["Talk welcome workflow launch"] --> LaunchCtx["buildArchitectureRunContext()"]
  Architect["ArchitectPage run options"] --> RunOptions["useArchitectRunOptions()"]
  LaunchCtx --> Api["startArchitectureRun()"]
  RunOptions --> Api
  Api --> Backend["ArchitectureRoleExecutor / LLMTurnRuntimeService"]
  Backend --> Limit["default non-tool-executor maxIterations = 4"]
  Limit --> Loop["Participant/router/finalizer subagent loops exhaust early"]
```

## Target architecture

```mermaid
flowchart TD
  Shared["shared architecture run defaults"]
  Shared --> Talk["Talk workflow launch"]
  Shared --> Architect["ArchitectPage launch"]
  Talk --> Api["startArchitectureRun() with unified limits"]
  Architect --> Api
  Api --> Backend["ArchitectureRoleExecutor"]
  Backend --> Limit["default non-tool-executor maxIterations = 8"]
  Limit --> Runtime["repo-scale architecture analysis can finish before exhaustion"]
```

## Affected models

```mermaid
erDiagram
  ChatSession ||--o| SessionRuntimeContext : carries
  SessionRuntimeContext ||--o| ArchitectureRuntimeContext : embeds
  ArchitectureRuntimeContext {
    number maxArchitectureSteps
    number maxArchitectureNodeVisits
    number maxArchitectureSubagentIterations
    string projectPath
    string executionCwd
  }
  ArchitectureRun ||--o{ ArchitectureExecutionEvent : emits
  ArchitectureRun {
    object context
    string executionMode
  }
```

## Notes

- Root cause evidence from live logs: all strategic-decision-council branch slots exhausted at `4` iterations, then router exhausted too.
- Talk workflow launch did not send architecture iteration defaults at all, while ArchitectPage kept a separate local `4`-iteration default.
- This slice moves both paths to one shared frontend default and raises the backend fallback for non-tool-executor architecture slots to `8`.
