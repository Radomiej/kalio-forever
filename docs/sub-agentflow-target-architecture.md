# Sub-AgentFlow Target Architecture

This document defines the target architecture for nested agent-flow delegation in Kalio.
It is design intent, not a claim that the feature is fully implemented today.

For the concise project-level diagrams, see [AgentFlow Architecture And Workflow](./agentflow-architecture-and-workflow.md).

## Current Implementation Status

As of 2026-05-31, Kalio has the first AgentFlow product boundary:

- Shared contracts in `@kalio/types`: `ChildExecutionKind`, `AgentFlowDefinition`, `AgentFlowRun`, `AgentFlowRunSnapshot`, `RunSubAgentFlowArgs`, `SubAgentFlowResult`.
- Native backend tool: `run_sub_agentflow`.
- API endpoints: `POST /api/agent-flows/runs`, `GET /api/agent-flows/runs/:id`, `GET /api/agent-flows/runs/:id/events`, `POST /api/agent-flows/runs/:id/resume`.
- Durable tables: `agent_flow_runs` and `agent_flow_events`.
- Frontend rendering for `run_sub_agentflow` results and Execution Graph `agent-flow` nodes.
- External QA evidence can now be passed back through AgentFlow resume context as `externalQualityGate` / `externalQualityGates`; Goal Master finalization is blocked while a failing/high-severity Playwright gate is present.
- Paid/live AgentFlow runs are gated by `docs/agentflow-paid-run-readiness-checklist.md`; mock E2E, focused regressions, typecheck, affected build, and active provider credential validation must pass before using paid LLM/CLI backends.
- Runtime context can now hard-disable CLI-agent tools with `availableCliAgents: []` or `architectureCliAgentsEnabled: false`, so unavailable paid backends are hidden instead of prompt-discouraged.
- Two-agent Goal Guard proof can opt into strict Implementer write proof with `requireImplementerWriteProof: true`; this fails a prose-only Implementer even if downstream nodes try to compensate.
- Parent Talk/Canvas projection now reconstructs persisted `run_sub_agentflow` results, identifies the linked child `agent-flow` session, and exposes open-chat/open-graph actions from the parent conversation.
- Mock full-stack Playwright coverage now verifies Talk-started two-agent Goal Guard flow, graph opening, durable result refresh, bounded resume, QA evidence resume, and bad-case rejection without paid LLM/CLI backends.
- Manual Playwright Orchestrator QA on 2026-06-01 verified the managed Kalio FE could open Talk, show the AgentFlow conversation, switch to Execution Graph, and render completed architecture nodes for run `0FLljN55_LvMDK0cO8AN1`. That run used the older split-write schema and is historical evidence only. Current Goal Master Delivery Loop proof is Implementer-owned and is covered by the newer mock E2E gate below.

Remaining gap: resume now records resume input, preserves the run checkpoint envelope, exposes a typed continuation cursor for bounded runtime stops, delegates to the Architecture adapter, and is covered by Architecture runtime tests plus full-stack mock E2E. Live paid real-project proof is still intentionally gated until the mock checklist remains green, warning-only manual UI findings are accepted or resolved, and the run is launched from Kalio FE.

## Core Idea

Kalio should support three distinct delegation kinds:

| Kind | Meaning | Runtime shape |
| --- | --- | --- |
| `sub_agent` | Ask one child chat agent to do one bounded task. | Child `ChatSession` plus one agent loop. |
| `cli_agent` | Delegate to an external CLI coding agent. | External process or durable CLI session plus status/progress. |
| `sub_agentflow` | Launch a child conversation that runs a full agent graph. | Child `ChatSession` plus `AgentFlowRun`, graph trace, agents, routers, guards, and final result. |

`sub_agentflow` is not "one more agent." It is a nested flow run exposed to the parent agent as a delegation tool.
It must support both blocking summary calls and durable long-lived workflows that can pause, resume, return to the orchestrator, and keep supervising child work.

```ts
type ChildExecutionKind =
  | 'sub_agent'
  | 'cli_agent'
  | 'sub_agentflow';
```

## Agent-Architecture-Lab Pattern Adoption

Kalio should adopt the useful Agent-Architecture-Lab patterns as backend-owned AgentFlow concepts, not by copying Lab's frontend Zustand stores.

| Lab pattern | Kalio contract/runtime target |
| --- | --- |
| Preset/canvas graph | `AgentFlowDefinition` with nodes, edges, entry node, orchestrator node, phases, tools, and layout hints. |
| Phase execution rank | `AgentFlowPhase`, `activePhases`, and `completedPhases` on `AgentFlowRun`. |
| Active/completed agents | `activeNodeIds`, `completedNodeIds`, and `nodeVisitCounts` on `AgentFlowRun`. |
| Pipeline output passing | Flow context includes upstream node outputs and tool evidence before each node execution. |
| Return-to-orchestrator loops | `AgentFlowEdge.returnToOrchestrator` plus `waiting_on_orchestrator` status and `returnToOrchestratorCount`. |
| Live monitor/history | `AgentFlowTraceItem[]` backed by durable runtime events and surfaced in chat/Execution Graph. |
| HITL pause points | `waiting_on_orchestrator` and HITL/tool-confirmation gates are first-class states, not prompt-only conventions. |

The MVP must therefore treat `run_sub_agentflow` as a start/resume handle for a real flow run. A blocking call is only one projection mode, not the core architecture.

## Semantics

```text
run_subagent
  -> one bounded child agent task

run_cli_agent / spawn_cli_agent
  -> external executor such as Codex CLI, Gemini CLI, Copilot CLI, or Claude Code

run_sub_agentflow
  -> create a child conversation and execute a selected graph/architecture inside it
```

For the parent agent, `sub_agentflow` is a tool call.
For the system, it is a full flow runtime with its own trace and child session.

## Mapping To Current Kalio

The target model should be implemented by reusing the existing architecture runtime rather than creating a parallel orchestration stack.

| Target concept | Current Kalio anchor | Target change |
| --- | --- | --- |
| `sub_agent` delegation kind | `run_subagent`, `spawn_subagent`, `message_subagent`, `SubagentRuntimeService`, `SubagentToolResult` | Add a shared `ChildExecutionKind` classifier so graph/UI/audit can distinguish single-agent child runs from flow children. |
| `cli_agent` delegation kind | `run_cli_agent`, `spawn_cli_agent`, `message_cli_agent`, `get_cli_agent_status`, `CLIAgentSessionSnapshot` | Treat durable CLI sessions as child execution records in graph/audit projections, not as plain tools only. |
| `sub_agentflow` delegation kind | `ArchitectureRuntimeService`, `ArchitectureGraphRuntime`, `ArchitectureRegistryService`, `ArchitectureSchema`, `ArchitectureExecutionEvent` | Expose nested architecture execution through `run_sub_agentflow` and rename/alias the reusable runtime as `AgentFlowRuntimeService` at the product boundary. |
| `AgentFlowDefinition` | `ArchitectureSchema` | Either alias `ArchitectureSchema` as the first `AgentFlowDefinition` implementation or introduce a thin wrapper with `schemaId -> flowId` mapping. |
| `AgentFlowRun` | Architecture run state plus root/branch sessions | Persisted through `agent_flow_runs` plus `agent_flow_events`; the runtime still needs checkpoint-level continuation for true paused graph resume. |
| Parent session | `ChatSession` and persisted parent `tool_result` messages | Persist a `run_sub_agentflow` tool result in the parent with a compact `SubAgentFlowResult`. |
| Child session | Existing architecture root session `arch-<runId>-root` and branch sessions | Use one child root `ChatSession` for the flow, with node/branch sessions underneath it. |
| Flow trace | `ArchitectureExecutionEvent`, durable graph projection, Talk Execution Graph | Standardize event names and expose `tracePreview` for parent chat bubbles. |
| VFS isolation/copy-back | `run_subagent` `vfsMode`, child VFS, copied outputs | Add the same `vfsMode`, `copyBack`, and artifact-copy behavior to `run_sub_agentflow`. |
| HITL/approvals | `ToolConfirmationService`, architecture auto-approval context | Ensure nested flow tool calls inherit parent-safe approval policy without bypassing HITL. |

## Target API Surface In Kalio Terms

`run_sub_agentflow` should be implemented as a native tool in `ToolModule`, not as a special frontend-only action.

Minimum tool args:

| Field | Maps to | Notes |
| --- | --- | --- |
| `flowId` | `ArchitectureSchema.id` initially | Accept existing schema ids such as `goal-master-delivery-loop` during the migration. |
| `goal` | Architecture run prompt | Required. This is the child flow's user objective. |
| `context` | Additional root/branch context | Optional string payload; later can become structured context. |
| `parentSessionId` | Current `sessionId` | Usually injected from `ToolCallRequest.sessionId`; callers should not spoof it. |
| `vfsMode` | Subagent VFS mode | `isolated` by default for safe artifact generation; `shared` only when parent VFS access is required. |
| `copyBack` | Child output copy policy | Default false for analysis, true for artifact-producing flows when requested. |
| `returnMode` | Parent result projection | `summary` by default; `full_trace` only when the parent needs full evidence. |
| `startMode` | Runtime scheduling mode | `durable` by default for supervised long-lived work; `blocking` only for bounded synchronous checks. |
| `maxSteps` | Architecture runtime step limit | Must be bounded. |

Minimum result payload:

| Field | Maps to | Notes |
| --- | --- | --- |
| `flowRunId` | Architecture run id / future `AgentFlowRun.id` | Stable id for API and graph lookup. |
| `childSessionId` | Flow root child session id | Opens the child flow as chat/graph. |
| `status` | Run status | Normalize to `done`, `failed`, `cancelled`, or `blocked` for parent tools. |
| `summary` | Final artifact or runtime summary | Must not hide incomplete child status. |
| `decisions` | Router/finalizer decisions | Extract from flow events/final artifact. |
| `nextActions` | Guard or finalizer next steps | Required for blocked/failed flows. |
| `artifacts` | Copied files, VFS paths, host paths | Only include verified artifacts. |
| `tracePreview` | Condensed `ArchitectureExecutionEvent[]` | Small enough for parent chat; full graph stays behind the run id. |

## Analogous Systems

| System | Similar concept | What Kalio should copy | What Kalio should avoid |
| --- | --- | --- | --- |
| LangGraph | Subgraphs and compiled graph runtime with persistence, streaming, HITL, and parallel node execution | Treat a nested flow as a graph node/tool result with durable trace and resumable state. | Do not leak low-level graph internals into normal chat messages. |
| LangGraph Supervisor / multi-agent patterns | Supervisor can coordinate specialized agents and even multi-level supervisors; subagents can be invoked as tools | Parent sees delegation as a tool/handoff while child graph owns internal routing. | Do not make the parent manually manage every child node once a flow is launched. |
| CrewAI Flows | Structured event-driven flows with state, routers/listeners, agents/crews inside flow steps, streaming and final output | Make flow state explicit, return a final output, and allow agents/crews as nodes. | Do not make every flow a separate workspace/project. |
| AutoGen AgentChat Teams | Teams/group chats run multiple agents toward a common goal and expose observable team behavior | Model multi-agent collaboration as a first-class run with inspectable events. | Do not use an unbounded group chat where Goal Guard acceptance criteria are implicit. |

These systems point to the same product shape: a parent agent delegates to a bounded child workflow, the child workflow owns internal agent routing, and the platform exposes state/trace/results without forcing the parent to micromanage every node.

Sources used for comparison:

- LangGraph multi-agent patterns and subagent/custom workflow guidance.
- LangGraph Pregel/compiled graph docs for nested subgraphs, persistence, streaming, HITL, and parallel supersteps.
- CrewAI Flow docs for event-driven stateful workflows, agents/crews inside flows, streaming, and final output.
- AutoGen AgentChat Teams docs for observable multi-agent teams and team presets.

## Gap Analysis

| Gap | Severity | Current evidence | Required work |
| --- | --- | --- | --- |
| `run_sub_agentflow` native tool needs live paid proof | Medium | Tool metadata, validation, dispatch integration, parent result rendering, Canvas child projection, and full FE-start mock E2E coverage exist. | After readiness gates stay green, run one paid real-project proof from Kalio FE and capture screenshots/logs. |
| Explicit `ChildExecutionKind` shared contract adoption is partial | Medium | `ChildExecutionKind` exists in `@kalio/types`; graph and tool result projections use `sub_agentflow`. | Continue replacing ad hoc child-kind strings in audit/projection surfaces. |
| `ArchitectureSchema` is not yet named as `AgentFlowDefinition` | Medium | Architecture registry already stores schemas/variants and graph nodes/edges. | Decide whether to alias, rename, or wrap. Prefer alias/wrapper first to avoid broad migration. |
| AgentFlow checkpointing needs more restart abuse coverage | High | `agent_flow_runs` and `agent_flow_events` persist the product-level snapshot/event stream. `AgentFlowRun.checkpoint` stores goal/context/VFS/copy/max-step/resume state and a typed continuation cursor; Architecture runtime can resume from the cursor without replaying completed root nodes. | Add broader process-restart E2E around waiting runs and verify no stale worker projection can finalize. |
| Durable resume API needs live/manual proof | High | `POST /api/agent-flows/runs/:id/resume`, snapshot, event endpoints, checkpoint envelope, runtime adapter delegation, and graph runtime continuation path exist. Mock FE E2E covers bounded resume and QA evidence resume. | Repeat the same path in live manual QA before paid project generation. |
| Return-to-orchestrator loops need live/manual proof | High | `AgentFlowEdge.returnToOrchestrator`, `waiting_on_orchestrator`, `returnToOrchestratorCount`, and max loop cap are implemented and covered by focused runtime tests. | Verify the visible Dev/Implementer <-> Goal Guard ping-pong in a live FE run before paid project generation. |
| Parent chat bubble and Canvas projection need live/manual proof | Medium | Tool-result renderer, open graph focus, Canvas AgentFlow preview, child session identification, and open-chat/open-graph actions are implemented and covered by focused tests. | Run Playwright manual QA against the managed Kalio FE and capture screenshots. |
| External browser QA was post-hoc instead of contractual | Medium | Live demo QA found Playwright focus/visual failures after AgentFlow had already reached `done`. Runtime now blocks Goal Master finalization when `externalQualityGate` context is failed or has high findings, and full-stack mock E2E proves Architect can resume a waiting AgentFlow with structured Playwright QA evidence. | Render the active quality gate in Conversations and Execution Graph, then repeat the proof in live manual QA. |
| Return modes are not standardized | Medium | Current graph/chat projections are architecture-specific. | Implement `summary`, `full_trace`, `artifacts_only` projection modes at tool-result level. |
| Flow event names are architecture-specific | Done | Adapter trace output now maps architecture events into reusable `flow:*` events and keeps `data.sourceEventType` for audit/debugging. | Continue using the normalized facade in new UI/API surfaces; do not reintroduce raw architecture event names as the AgentFlow public contract. |
| VFS copy-back for flow children is not specified in code contract | Medium | `run_subagent` already has VFS/copy-output behavior; architecture runs use root/branch sessions. | Port the same copy-back semantics to `run_sub_agentflow`. |
| Two-agent target naming is inconsistent | Medium | Current runtime schema is `goal-master-delivery-loop`; target doc calls `goal_guard_delivery_loop`. | Either add alias `goal_guard_delivery_loop -> goal-master-delivery-loop` or rename with migration. |
| Live QA can still accidentally test Five Minds | High | Existing docs/session history include many Five Minds proofs. | Keep `kalio-manual-qa` and AGENTS rule: two-agent validation must use Dev/Implementer <-> Goal Guard, not Five Minds. |

## Implementation Slice Recommendation

Implement this in small slices:

1. Add shared contracts only: `ChildExecutionKind`, `RunSubAgentFlowArgs`, `SubAgentFlowResult`.
2. Add `run_sub_agentflow` tool that initially wraps existing `ArchitectureRuntimeService` and accepts existing `ArchitectureSchema.id` as `flowId`.
3. Persist/return `flowRunId` and `childSessionId`, then render a parent chat flow bubble and Canvas preview with open chat/open graph.
4. Normalize trace preview from `ArchitectureExecutionEvent` without replacing the existing durable graph.
5. Add `goal_guard_delivery_loop` as an alias for `goal-master-delivery-loop`.
6. Only after the wrapper is stable, rename/refactor internals toward `AgentFlowRuntimeService`.

## Target Tool Contract

```ts
type RunSubAgentFlowArgs = {
  flowId: string;
  goal: string;
  context?: string | Record<string, unknown>;
  parentSessionId: string;
  vfsMode?: 'isolated' | 'shared';
  copyBack?: boolean;
  returnMode?: 'summary' | 'full_trace' | 'artifacts_only';
  startMode?: 'durable' | 'blocking';
  maxSteps?: number;
};

type SubAgentFlowResult = {
  flowRunId: string;
  childSessionId: string;
  status: 'queued' | 'running' | 'waiting_on_orchestrator' | 'done' | 'failed' | 'cancelled' | 'blocked';
  summary: string;
  decisions: string[];
  nextActions: string[];
  artifacts: string[];
  tracePreview?: AgentFlowTraceItem[];
  openChatSessionId?: string;
  openGraphRunId?: string;
};
```

## Minimal Runtime Model

Do not start with a separate workspace/project orchestrator. Start with a nested flow under the existing session model:

```text
Parent ChatSession
  -> run_sub_agentflow(...)
       -> creates Child ChatSession
       -> creates AgentFlowRun
       -> executes AgentFlowRuntime
       -> streams flow events
       -> returns summary/result to parent
```

Initial persisted entities:

```ts
type AgentFlowDefinition = {
  id: string;
  name: string;
  version: number;
  entryNodeId: string;
  nodes: AgentFlowNode[];
  edges: AgentFlowEdge[];
};

type AgentFlowRun = {
  id: string;
  parentSessionId: string;
  childSessionId: string;
  flowDefinitionId: string;
  status: 'queued' | 'running' | 'waiting_on_orchestrator' | 'done' | 'failed' | 'cancelled' | 'blocked';
  startMode: 'durable' | 'blocking';
  returnMode: 'summary' | 'full_trace' | 'artifacts_only';
  activeNodeIds?: string[];
  completedNodeIds?: string[];
  waitingForNodeId?: string;
  checkpoint?: {
    goal: string;
    context?: string | Record<string, unknown>;
    vfsMode?: 'isolated' | 'shared';
    copyBack?: boolean;
    maxSteps?: number;
    continuation?: {
      reason: 'max_steps' | 'return_to_orchestrator' | 'runtime_pause';
      waitingNodeId?: string;
      pendingNodeIds: string[];
      visitCounts: Record<string, number>;
      lastCompletedNodeId?: string;
      lastRoute?: {
        fromNodeId: string;
        selectedNodeIds: string[];
        nextNodeId?: string;
        source?: 'agent' | 'router' | 'parallel' | 'runtime_fallback';
        response?: string;
      };
      message?: string;
    };
    lastResumeInput?: string;
    resumeContext?: Record<string, unknown>;
  };
  summary?: string;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
};
```

## UI Target

The parent chat should show a compact delegated-flow bubble:

```text
AgentFlow: Architecture Debate
status: running
nodes:
  done: Context Builder
  done: Pragmatic Architect
  done: Skeptic Reviewer
  running: Merge
  pending: Guard
```

The bubble should expose:

- open as child chat,
- open as graph,
- inspect tool calls and trace,
- copy artifacts back when `copyBack` is enabled.

## Required First Flows

| Flow | Purpose |
| --- | --- |
| `architecture_debate` | Bounded architecture analysis with merge and guard. |
| `coding_review` | Implementer/reviewer loop for code changes. |
| `deep_research` | Research fan-out with synthesis and cited summary. |
| `release_guard` | Final readiness gate before claiming completion. |
| `goal_guard_delivery_loop` | Two-agent loop: Dev/Implementer writes or delegates, Goal Guard verifies evidence and routes back until complete or blocked. |

The `goal_guard_delivery_loop` is the correct target for requests about the two-agent architecture. Five Minds is not a substitute for this flow.

## Phased Delivery

| Phase | Scope |
| --- | --- |
| 1 | JSON `AgentFlowDefinition`, `AgentFlowRuntimeService`, `run_sub_agentflow`, child session, summary result. |
| 2 | Flow event streaming: `flow:node_start`, `flow:node_result`, `flow:edge_taken`, UI bubble, graph trace. |
| 3 | Built-in flow library: `architecture_debate`, `coding_review`, `deep_research`, `release_guard`, `goal_guard_delivery_loop`. |
| 4 | Only after nested flows are stable: project/workspace orchestration. |

## Non-Goals For The MVP

- No heavyweight workspace super-orchestrator.
- No new project abstraction before nested flow composition works.
- No hidden substitution of a different graph when the user requests the two-agent Dev/Goal-Guard loop.

## 2026-05-31 Implementation Status

Implemented:

- `AgentFlowRun` and trace contracts are now shared in `@kalio/types`.
- `/api/agent-flows/runs` starts, reads, lists events, and exposes resume as first-class API.
- `run_sub_agentflow` is registered as a native tool contract.
- `goal_guard_delivery_loop` is aliased to the current `goal-master-delivery-loop` runtime schema.
- Architect FE has a dedicated Goal Guard start action that posts to `/api/agent-flows/runs`.
- Root architecture sessions created through AgentFlow are persisted with `kind = 'agent-flow'`.
- Durable AgentFlow runs reconcile their status from the underlying architecture runtime after async completion so stale `running` rows do not hang.
- `AgentFlowRun.checkpoint` persists original goal/context/VFS/copy/max-step state and records latest resume input/context, so resume no longer rebuilds adapter args from a lossy synthetic prompt.
- Bounded architecture runs that stop with pending nodes are projected as `waiting_on_orchestrator` with `waitingForNodeId`, `activeNodeIds`, `nodeVisitCounts`, and `checkpoint.continuation`.
- `AgentFlowRuntimeService.resume` now preserves resume checkpoint updates during refresh and delegates to adapters that implement `resume`.
- `AgentFlowRuntimeService.resume` merges structured resume context into the next runtime invocation, so external QA evidence is not lost after the user resumes a waiting flow.
- `ArchitectureAgentFlowAdapter.resume` passes checkpoint continuation into `ArchitectureRuntimeService.resumeRun`, which re-enters graph execution with resume context and updated step budget.
- `ArchitectureGraphRuntime` treats failing/high-severity external quality gates as finalization blockers and routes Goal Master back to the implementer branch.
- Architect FE exposes a waiting-run action to resume Goal Guard AgentFlow with structured Playwright QA evidence (`source`, `status`, `highFindings`, `summary`, artifact path).
- Architecture adapter trace output now exposes product-level `flow:*` events (`flow:node_start`, `flow:node_result`, `flow:edge_taken`, `flow:guard_result`, `flow:final_artifact`) while preserving the original architecture event kind in `data.sourceEventType`.
- Settings MCP import now discovers workspace-parent `.vscode/mcp.json` even when the API process runs from a nested cwd, parses BOM-prefixed JSON, defaults to selecting no external servers, and de-dupes equivalent discovered server signatures within one scan/import batch.
- Orchestration slots now propagate `vfs_write` auto-approval to delegated subagents so VFS-only proof creation cannot hang behind invisible subagent HITL while host writes remain explicit opt-in.
- Max-node-visit stops now emit terminal guard events with pending nodes and visit counts instead of silently ending without finalization.
- AgentFlow API/tool entrypoints reject invalid parent/session payloads before orphaned runs are created, and API supports listing runs by parent session.
- `run_sub_agentflow` return modes now have executable semantics at the adapter boundary: `summary` keeps the compact trace tail, `full_trace` returns the full mapped trace, and `artifacts_only` suppresses decisions/trace while preserving status, summary, artifacts, and open handles.

Current live proof:

- FE-triggered run `7LyDLGyYj0t1wtPrvlCY8` created `agent_flow_runs.flow_definition_id = goal_guard_delivery_loop`.
- Root session `arch-7LyDLGyYj0t1wtPrvlCY8-root` was persisted as `kind = agent-flow`.
- The run persisted 12 trace events and reconciled from `running` to `failed`.
- Failure reason was valid guard behavior: the implementation path produced no required write/tool evidence.
- Later FE-triggered VFS proof run completed with `done`: production Goal Guard flow produced Implementer `vfs_write` evidence, Verifier/Tester/Goal Master `vfs_read` evidence, and a final accepted artifact.
- Latest full-stack mock E2E run passed through Kalio FE on 2026-06-03:
  - `apps/e2e/tests/agentflow-goal-guard.spec.ts` starts the dedicated Goal Guard AgentFlow from the Architect UI.
  - The graph projection asserts `Implementer` and `Goal Master` are visible and explicitly rejects `Five Minds`.
  - The run writes `e2e/goal-guard-proof.json` from the Implementer through `vfs_write`, renders the executed route, and shows final chat evidence.
  - The test attaches `goal-guard-agentflow-graph` and `goal-guard-agentflow-chat` screenshots to the Playwright report.
  - The suite also verifies failure-first behavior for prose-only Implementer output and resumes a bounded waiting run through `POST /api/agent-flows/runs/:id/resume`.
- The suite now verifies the FE "Resume with QA evidence" path: a waiting Goal Guard AgentFlow receives structured Playwright evidence, persists `checkpoint.resumeContext.externalQualityGate`, and does not reach `done`.
- Parent Talk/Conversations now renders waiting Goal Guard flow results with QA next actions and trace handoff details; Canvas shows the waiting flow preview; Execution Graph opens the child Goal Guard run without substituting Five Minds.
- Latest verification command on 2026-06-03: `npm.cmd --prefix apps/e2e run test:e2e -- agentflow-goal-guard.spec.ts --project=chromium` passed with 11 tests on a random-port mock stack after the Implementer-proof refactor.
- Latest local readiness gate on 2026-06-01:
  - `kalio-api` typecheck passed.
  - `kalio-api` build passed.
  - `kalio-web` typecheck passed.
  - `kalio-web` build passed, with only the existing Vite chunk-size warning.
  - `kalio-api` coverage: statements 87.64%, branches 80.94%, functions 89.45%, lines 87.64%.
  - `kalio-web` coverage: statements 80.98%, branches 73.09%, functions 79.78%, lines 82.97%.
- Live managed Kalio QA on `http://localhost:5188` verified Settings -> MCP Servers -> Import can import only the repo-local `mcp-dev-servers`; after import the live API reported `Playwright Orchestrator` connected with 49 tools and `mcp-dev-servers` connected with 16 tools.
- Live FE-triggered bounded Goal Guard run `BFRt4WbQ3or_vluixhH89` used `goal_guard_delivery_loop`, `maxArchitectureSteps = 2`, and reached `waiting_on_orchestrator` under the older split-write schema. Treat it as historical, not current release evidence.
- Live Playwright QA evidence was submitted from the Architect UI and persisted as `checkpoint.resumeContext.externalQualityGate` with `status = failed`, `highFindings = 1`, and a screenshot artifact; the run correctly stayed `waiting_on_orchestrator` instead of finalizing.
- Live paid real-project proof is currently blocked by provider authentication. `npm.cmd run agentflow:activate-live-credential -- --provider xiaomimimo --model mimo-v2.5-pro --base-url https://token-plan-ams.xiaomimimo.com/v1` can create and activate the DB-backed Kalio credential from ignored `.env.test`, and the managed API then reports live Xiaomi provider state from DB.
- `npm.cmd run agentflow:paid-readiness` now enforces the pre-paid gate and validates the active credential through Kalio's provider-test endpoint. It currently fails for one hard blocker: the active Xiaomi credential returns `Invalid API Key`.

Mock/runtime test scenario coverage:

| Scenario | Evidence | Purpose |
| --- | --- | --- |
| MockLLM reject-then-accept loop | `architecture-runtime.llm-integration.spec.ts` | Proves return-to-implementer routing then finalization when Goal Master accepts. |
| MockLLM immediate accept | `architecture-runtime.llm-integration.spec.ts` | Proves direct Goal Master acceptance path. |
| MockLLM reject-forever bounded failure | `architecture-runtime.llm-integration.spec.ts` | Proves max-step guard emits stop payload and prevents final artifact. |
| Production Goal Master schema with deterministic tool events | `architecture-runtime.llm-integration.spec.ts` | Proves real `tool_executor` Implementer/Verifier evidence path: `vfs_write`, `vfs_read`, Goal Master acceptance. |

Remaining gaps before calling this architecture production-complete:

- Resume is API-visible, E2E-covered, and has architecture runtime re-entry. Unit/runtime evidence proves cursor-based resume can avoid replaying completed root nodes; broader process-restart E2E should still abuse waiting runs and stale worker projections.
- Unresolved CLI child implementation now has settled runtime semantics: ArchitectureRuntime keeps continuation-capable max-node-visit stops `running`, hard max-step exhaustion remains `failed`, and AgentFlow projects continuation stops as `waiting_on_orchestrator`.
- Native `run_sub_agentflow` is now wired into the executable chat tool registry, not only the catalog/API layer.
- The live Implementer/CLI-child path still needs a fresh real-project proof after the CLI-child status contract is fixed, so project creation through the full Dev/Goal-Guard loop is not yet production-proven.
- Frontend Conversations visibility now has focused Canvas tests and mock full-stack E2E coverage for Talk-started AgentFlow runs. It still needs a live manual QA screenshot pass against the managed localhost Kalio service.
- The live bounded proof exposed a product-level flow gap in the older schema: the Implementer slot was effectively read-only and the next continuation target was a separate write node. Current schema removes that handoff; the Implementer owns write proof directly, and the current mock E2E proves that path before any paid rerun.
- Final paid/live proof remains gated: do not run the real `C:\Projekty\TurboProject2` generation until the managed FE manual QA screenshot pass confirms Conversations, child chat, Execution Graph, QA resume evidence, and no stale running projection.
