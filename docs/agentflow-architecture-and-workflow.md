# AgentFlow Architecture And Workflow

This document is the project-level map for Kalio's architecture runtime and AgentFlow work model. It is intended as the short onboarding view before reading the deeper target architecture and refactor plans.

## Runtime Architecture

```mermaid
flowchart LR
  User["User"]
  Web["Kalio Web\nReact UI"]
  Gateway["ChatGateway\nSocket.IO"]
  Chat["Chat bounded context\nsessions, messages, lineage"]
  Architect["Architect UI\nschema editor, variants, run controls"]
  Registry["Architecture Registry\nschemas and variants"]
  Runtime["Architecture Runtime\nnode execution, routing, events"]
  AgentFlow["AgentFlow Runtime\nnested durable flow facade"]
  Tools["Tool Dispatch\nVFS, terminal, MCP, CLI, subagents"]
  VFS["VFS Service\nsession files"]
  Memory["Memory\npersona vectors and session state"]
  Audit["Audit / Projections\ntimeline, graph, chat, truth board"]
  LLM["LLM Providers\nconfigured backend only"]

  User --> Web
  Web --> Gateway
  Web --> Architect
  Gateway --> Chat
  Chat --> Tools
  Chat --> Memory
  Architect --> Registry
  Architect --> Runtime
  Runtime --> Registry
  Runtime --> Chat
  Runtime --> Tools
  Runtime --> Audit
  AgentFlow --> Runtime
  AgentFlow --> Audit
  Tools --> VFS
  Tools --> LLM
  Tools --> Audit
  Runtime --> LLM
```

Key ownership rules:

| Area | Owns | Notes |
| --- | --- | --- |
| Kalio Web | Rendering, editor draft state, run controls, visual projections | It does not execute LLM/tool work and must not infer runtime status from message text or opaque ID prefixes. |
| Chat | Session isolation, parent/child lineage, persisted messages | Chat is a projection surface; turn/chat status must come from backend runtime snapshots and durable events. |
| Architecture Registry | Seed schemas and user-created variants | User graph edits are persisted by saving a variant. |
| Architecture Runtime | Graph node execution, routing, status, events | Runtime state is observable as timeline, graph, and chat projection. |
| AgentFlow Runtime | Durable nested flow facade | Current adapter is the architecture runtime. |
| Tool Dispatch | Tool policy, confirmation, MCP/CLI/VFS integration | Tool availability is policy-driven per context/persona. |

## Runtime Contract Boundary

The backend runtime event history is the source of truth for workflow state. UI projections must consume explicit fields such as `status`, `reasonCode`, `errorCode`, `failure`, `evidence`, `runtimeDecision`, `runId`, `nodeId`, `parentToolCallId`, and `architectureRunId`.

Human-readable fields such as `message`, `detail`, `summary`, `actionSummary`, tool output prose, and LLM text are display-only. They cannot drive retry, finalization, terminal-state routing, graph hydration, or chat/session status.

When an LLM is expected to produce a machine decision, the runtime must request a structured output that maps to the typed contract instead of parsing free-form assistant prose.

## Work Flow

```mermaid
flowchart TD
  Start["User selects or edits architecture"]
  Draft["Editor Draft\nnode positions, edges, behaviors, persona overrides"]
  Save{"Save variant?"}
  Variant["Persist versioned schema variant"]
  Run["Start run\nschema + draft + run context"]
  RuntimeMode["Runtime mode\nobserve graph, timeline, chat"]
  Node["Execute active node"]
  Router{"Router / guard decision"}
  Parallel["Parallel or cascade branches"]
  Review["Reviewer / Goal Guard"]
  Done{"Goal achieved?"}
  Artifact["Final artifact and evidence"]
  Reset["Return to editor\nruntime overlay clears; saved variants remain"]

  Start --> Draft
  Draft --> Save
  Save -- yes --> Variant
  Save -- no --> Run
  Variant --> Run
  Run --> RuntimeMode
  RuntimeMode --> Node
  Node --> Router
  Router -- fan out --> Parallel
  Parallel --> Review
  Router -- direct route --> Review
  Review --> Done
  Done -- no --> Router
  Done -- yes --> Artifact
  Artifact --> Reset
```

The product behavior should feel like an editor/runtime split:

- **Editor mode:** user edits graph topology, node positions, node behavior, context policy, and persona overrides.
- **Save variant:** user persists those edits as a versioned architecture schema variant.
- **Runtime mode:** user observes active nodes, visit counts, tool activity, timeline events, and child sessions.
- **Runtime reset:** temporary run visualization clears when the run ends or the user returns to editing; only saved variants remain durable.
- **Free-space canvas:** the graph work surface is intentionally larger than the visible node cluster, so users can pan and stage diagrams even when the current graph fits on screen.
- **Auto-layout:** Architect can reflow the graph on demand into ranked columns, with parallel branches vertically centered around the source and merge nodes.
- **Connection semantics:** solid sky edges are forced transitions, dashed amber edges are router/master-agent decisions, dotted violet edges are parallel fan-out, and pulsing emerald edges are runtime-executed transitions.

## Delegation Flow

```mermaid
sequenceDiagram
  participant U as User
  participant FE as Kalio Web
  participant AR as Architecture Runtime
  participant AF as AgentFlow Runtime
  participant T as Tool Dispatch
  participant C as Child Sessions
  participant Q as Reviewer / Goal Guard

  U->>FE: choose schema, edit graph, start run
  FE->>AR: POST architecture run or AgentFlow run
  AR->>C: create root and branch sessions
  AR->>T: expose policy-scoped tools
  AR->>AR: execute active graph node

  alt node needs nested workflow
    AR->>AF: run_sub_agentflow
    AF->>C: create child flow session
    AF->>AR: execute child architecture adapter
    AF-->>AR: summary, status, trace preview
  else node uses direct tools
    AR->>T: VFS / MCP / CLI / subagent tool call
    T-->>AR: tool result and evidence
  end

  AR->>Q: review evidence and route
  Q-->>AR: structured routerOutput route or typed final approval
  AR-->>FE: events, graph projection, chat projection
  FE-->>U: active node, visit counts, artifacts, final status
```

## Release Gates For Runtime Work

Before using paid/live backends for AgentFlow proof:

1. Focused unit/regression tests pass for changed contracts.
2. Affected app typecheck passes.
3. Affected app build passes.
4. Mock FE/E2E or browser proof verifies the user-visible runtime path.
5. `docs/agentflow-paid-run-readiness-checklist.md` is complete.

Related documents:

- [Sub-AgentFlow Target Architecture](./sub-agentflow-target-architecture.md)
- [Sub-AgentFlow DDD Refactor Plan](./superpowers/plans/2026-05-31-sub-agentflow-ddd-refactor.md)
- [Paid Run Readiness Checklist](./agentflow-paid-run-readiness-checklist.md)
