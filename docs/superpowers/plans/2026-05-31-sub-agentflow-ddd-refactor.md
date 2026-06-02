# Sub-AgentFlow DDD Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Kalio from architecture-specific orchestration into a clean `sub_agentflow` system where a parent agent can start, supervise, resume, and complete durable child flows such as `goal_guard_delivery_loop`.

**Architecture:** Keep the existing `ArchitectureRuntimeService` as the first adapter, but introduce a product-level AgentFlow bounded context with explicit contracts, application services, persistence ports, normalized events, resumable run state, and UI projections. Adopt Agent-Architecture-Lab's graph/preset/phase/supervision patterns as backend-owned contracts, not as copied frontend stores.

**Tech Stack:** TypeScript 5.8 strict, NestJS 11, React 19, Vitest, Playwright, pnpm/Turborepo.

---

## Current Mapping

| Target concept | Current implementation | Refactor direction |
| --- | --- | --- |
| `sub_agent` | `apps/kalio-api/src/modules/tool/tools/subagent.tool.ts`, `SubagentRuntimeService`, `SubagentToolResult` | Keep as single-child-agent delegation. Add a shared child execution classifier. |
| `cli_agent` | `apps/kalio-api/src/modules/tool/tools/run-cli-agent.tool.ts`, `cli-agent-session.tools.ts`, `apps/kalio-api/src/modules/cli-agent/*` | Keep as external executor delegation. Expose it consistently in flow graph/audit projections. |
| `sub_agentflow` | Partial equivalent in `apps/kalio-api/src/modules/architecture/*` | Add `run_sub_agentflow` as product API/tool. Wrap architecture runtime first, then move naming toward AgentFlow. |
| Flow definition | `ArchitectureSchema` in `@kalio/types` and `ArchitectureRegistryService` | Introduce `AgentFlowDefinition` facade/alias before any broad rename. |
| Flow run | `ArchitectureRun` plus root/branch sessions/events | Introduce `AgentFlowRun` projection with parent session, child session, status, return mode, and trace preview. |
| Flow root session | `ChatSession.kind` supports explicit `agent-flow` roots with parent session/tool-call lineage. | Keep using explicit flow session kind; do not reintroduce id-prefix inference as the product contract. |
| Flow UI | Architect page, Talk Execution Graph, parent tool-result bubble, and Canvas AgentFlow preview. | Finish live manual QA screenshots for parent chat -> child chat -> graph navigation. |

## DDD Target Boundaries

| Bounded context | Owns | Must not own |
| --- | --- | --- |
| `AgentFlow` | Flow definitions, flow runs, flow events, run status, parent result projection | CLI process management, low-level chat persistence, VFS implementation details |
| `AgentDelegation` | Shared child execution types: `sub_agent`, `cli_agent`, `sub_agentflow` | Flow graph execution internals |
| `ArchitectureAdapter` | Existing architecture schemas/runtime as an adapter behind `AgentFlowRuntimePort` | Public product naming for new features |
| `Chat` | Sessions, messages, parent/child lineage, message persistence | Flow routing logic |
| `Tool` | Native tool registration and HITL metadata | Business rules for flow completion |
| `CLI Agent` | Process/session lifecycle for Codex/Gemini/Copilot/Claude | Goal Guard acceptance decisions |
| `VFS` | Session file storage and copy-back primitives | Deciding which artifacts prove flow completion |
| `Kalio Web` | UI projection and QA affordances | Backend truth about flow status |

## Agent-Architecture-Lab Adoption Rules

Port concepts, not implementation details:

| Lab concept | Kalio target |
| --- | --- |
| Preset/canvas graph | Backend `AgentFlowDefinition` with node/edge layout hints. |
| `orchestrationStore` phase tracking | `AgentFlowRun.activePhases`, `completedPhases`, `activeNodeIds`, `completedNodeIds`. |
| Pipeline execution loop | Durable `AgentFlowRuntimeService` with bounded resume steps. |
| Return-to-orchestrator edges | `AgentFlowEdge.returnToOrchestrator`, `waiting_on_orchestrator`, and max loop counters. |
| Execution history | Durable `AgentFlowTraceItem` event stream visible in chat and Execution Graph. |
| VFS store | Existing Kalio session VFS with explicit `vfsMode` and `copyBack` policies. |

The default `run_sub_agentflow` path must be `startMode: durable`. `startMode: blocking` is allowed only for small synchronous checks.

## AAA Principles For This Refactor

AAA here means tests and flow checks use explicit **Arrange / Act / Assert** structure.

| Layer | Arrange | Act | Assert |
| --- | --- | --- | --- |
| Contract tests | Build valid/invalid `RunSubAgentFlowArgs` and `SubAgentFlowResult` values | Parse/normalize with shared contract helpers | Invalid values fail; valid values preserve discriminants and ids |
| Tool tests | Mock `AgentFlowRuntimePort`, create a `ToolCallRequest` | Execute `run_sub_agentflow` | Runtime receives injected `parentSessionId`; tool returns stable `SubAgentFlowResult` |
| Runtime tests | Seed a `goal_guard_delivery_loop` alias and mocked architecture runtime | Start nested flow | Creates child root session, emits events, blocks incomplete children |
| Quality-gate tests | Seed failing Playwright audit evidence into resume/context | Goal Master tries to accept | Runtime routes back to Implementer and does not emit a final artifact |
| Projection tests | Build normalized flow events and result payload | Build chat/graph/canvas projection | Parent bubble, Canvas, and Execution Graph show `sub_agentflow`, not Five Minds |
| E2E tests | Start Kalio FE, create run from Architect/Talk UI | Run bounded mock two-agent flow | Conversations update, graph progresses, resume works, QA evidence blocks/continues correctly |

## External Analogues

| System | Useful practice for Kalio | What to avoid |
| --- | --- | --- |
| LangGraph subgraphs | Nested graph execution can have its own state, persistence, streamed subgraph outputs, and human-in-the-loop checkpoints. | Do not force the parent chat to micromanage internal child nodes. |
| LangGraph multi-agent/supervisor | Supervisor delegates to agents or workflows as tools while child workflows own routing. | Do not hide the child flow trace behind a plain text answer. |
| CrewAI Flows | Event-driven flows with explicit state, routing/listeners, persistence, and final output. | Do not make every flow a separate project/workspace. |
| AutoGen AgentChat Teams | A team is an observable multi-agent run with a shared task and inspectable progress. | Do not use unbounded group chat semantics for Goal Guard acceptance. |

Reference docs:

- LangGraph subgraphs: https://docs.langchain.com/oss/python/langgraph/use-subgraphs
- LangGraph persistence: https://docs.langchain.com/oss/python/langgraph/persistence
- CrewAI Flows: https://docs.crewai.com/en/concepts/flows
- AutoGen AgentChat Teams: https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html
- DDD reference summary: https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf

---

## Refactor Slices

### Task 1: Shared AgentFlow Contracts

**Files:**
- Modify: `packages/@kalio/types/src/index.ts`
- Modify: `packages/@kalio/types/src/__tests__/contracts.test.ts`

- [ ] **Step 1: Add failing contract tests**

Add tests that verify the public contract shape:

```ts
import type {
  AgentFlowRun,
  ChildExecutionKind,
  RunSubAgentFlowArgs,
  SubAgentFlowResult,
} from '../index';

it('supports all child execution kinds', () => {
  const kinds: ChildExecutionKind[] = ['sub_agent', 'cli_agent', 'sub_agentflow'];
  expect(kinds).toContain('sub_agentflow');
});

it('models run_sub_agentflow args and result', () => {
  const args: RunSubAgentFlowArgs = {
    flowId: 'goal_guard_delivery_loop',
    goal: 'Build and verify the requested website',
    parentSessionId: 'parent-1',
    vfsMode: 'isolated',
    copyBack: true,
    returnMode: 'summary',
    maxSteps: 12,
  };
  const result: SubAgentFlowResult = {
    flowRunId: 'flow-run-1',
    childSessionId: 'flow-child-1',
    status: 'done',
    summary: 'Goal Guard accepted the result.',
    decisions: ['Implementation passed verification'],
    nextActions: [],
    artifacts: ['dist/index.html'],
  };
  const run: AgentFlowRun = {
    id: 'flow-run-1',
    parentSessionId: args.parentSessionId,
    childSessionId: result.childSessionId,
    flowDefinitionId: args.flowId,
    status: 'done',
    returnMode: 'summary',
    createdAt: 1,
    updatedAt: 2,
    finishedAt: 2,
  };
  expect(run.flowDefinitionId).toBe('goal_guard_delivery_loop');
});

it('supports agent-flow chat sessions without id-prefix inference', () => {
  const session: ChatSession = {
    id: 'child-flow-1',
    personaId: 'default',
    title: 'Goal Guard flow',
    kind: 'agent-flow',
    parentSessionId: 'parent-1',
    parentToolCallId: 'call-1',
    createdAt: 1,
    updatedAt: 1,
  };
  expect(session.kind).toBe('agent-flow');
});
```

- [ ] **Step 2: Run contract tests and confirm failure**

Run:

```powershell
npm.cmd --prefix packages/@kalio/types run test -- contracts.test.ts
```

Expected: TypeScript compile failure because the new types do not exist.

- [ ] **Step 3: Add minimal shared types**

Add to `packages/@kalio/types/src/index.ts` near session/tool contracts:

```ts
export type ChildExecutionKind = 'sub_agent' | 'cli_agent' | 'sub_agentflow';

export type AgentFlowRunStatus = 'running' | 'done' | 'failed' | 'cancelled' | 'blocked';
export type AgentFlowReturnMode = 'summary' | 'full_trace' | 'artifacts_only';

export interface RunSubAgentFlowArgs {
  flowId: ID;
  goal: string;
  context?: string | Record<string, unknown>;
  parentSessionId: ID;
  vfsMode?: VFSMode;
  copyBack?: boolean;
  returnMode?: AgentFlowReturnMode;
  maxSteps?: number;
}

export interface AgentFlowTraceItem {
  id: ID;
  sequence: number;
  type: string;
  message: string;
  nodeId?: string;
  status?: AgentFlowRunStatus;
  createdAt: Timestamp;
}

export interface SubAgentFlowResult {
  flowRunId: ID;
  childSessionId: ID;
  status: Exclude<AgentFlowRunStatus, 'running'>;
  summary: string;
  decisions: string[];
  nextActions: string[];
  artifacts: string[];
  tracePreview?: AgentFlowTraceItem[];
}

export interface AgentFlowRun {
  id: ID;
  parentSessionId: ID;
  childSessionId: ID;
  flowDefinitionId: ID;
  status: AgentFlowRunStatus;
  returnMode: AgentFlowReturnMode;
  summary?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  finishedAt?: Timestamp;
}
```

Extend session kinds in the same file:

```ts
export type ChatSessionKind = 'chat' | 'subagent' | 'cli-agent' | 'agent-flow';

export interface ChatSession {
  id: ID;
  personaId: ID;
  title: string;
  kind?: ChatSessionKind;
  parentSessionId?: ID;
  parentTurnId?: ID;
  parentToolCallId?: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateSessionDto {
  personaId: ID;
  title?: string;
  kind?: ChatSessionKind;
  parentSessionId?: ID;
  parentTurnId?: ID;
  parentToolCallId?: ID;
}
```

- [ ] **Step 4: Run contract tests and typecheck**

Run:

```powershell
npm.cmd --prefix packages/@kalio/types run test -- contracts.test.ts
corepack pnpm --filter @kalio/types run typecheck
```

Expected: tests and typecheck pass.

### Task 2: AgentFlow Runtime Port And Architecture Adapter

**Files:**
- Create: `apps/kalio-api/src/modules/agent-flow/agent-flow.types.ts`
- Create: `apps/kalio-api/src/modules/agent-flow/agent-flow-runtime.port.ts`
- Create: `apps/kalio-api/src/modules/agent-flow/architecture-agent-flow.adapter.ts`
- Create: `apps/kalio-api/src/modules/agent-flow/architecture-agent-flow.adapter.spec.ts`
- Modify: `apps/kalio-api/src/modules/architecture/architecture.module.ts`

- [ ] **Step 1: Write failing adapter tests**

The test should arrange a mocked `ArchitectureRuntimeService`, act through the new adapter, and assert it maps `goal_guard_delivery_loop` to `goal-master-delivery-loop`.

```ts
it('maps goal_guard_delivery_loop to the current goal-master schema', async () => {
  const architectureRuntime = {
    createRun: vi.fn().mockResolvedValue({
      id: 'run-1',
      rootSessionId: 'arch-run-1-root',
      schemaId: 'goal-master-delivery-loop',
      status: 'completed',
      createdAt: 1,
      updatedAt: 2,
      completedAt: 2,
    }),
    getEvents: vi.fn().mockReturnValue([]),
  };
  const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as never);
  const result = await adapter.run({
    flowId: 'goal_guard_delivery_loop',
    goal: 'Implement and verify',
    parentSessionId: 'parent-1',
    returnMode: 'summary',
  });
  expect(architectureRuntime.createRun).toHaveBeenCalledWith(expect.objectContaining({
    schemaId: 'goal-master-delivery-loop',
    prompt: 'Implement and verify',
  }), expect.anything());
  expect(result.childSessionId).toBe('arch-run-1-root');
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm.cmd --prefix apps/kalio-api run test -- architecture-agent-flow.adapter.spec.ts
```

Expected: missing files/classes.

- [ ] **Step 3: Add the port and adapter**

Create a small port:

```ts
import type { RunSubAgentFlowArgs, SubAgentFlowResult } from '@kalio/types';

export const AGENT_FLOW_RUNTIME = Symbol('AGENT_FLOW_RUNTIME');

export interface AgentFlowRuntimePort {
  run(args: RunSubAgentFlowArgs): Promise<SubAgentFlowResult>;
}
```

Implement the architecture adapter as a thin wrapper. It must not duplicate graph logic.

- [ ] **Step 4: Export provider from `ArchitectureModule` or a new `AgentFlowModule`**

Preferred clean direction: create `AgentFlowModule` in Task 3. For this task, only prove the adapter can wrap the existing service.

- [ ] **Step 5: Run tests**

Run:

```powershell
npm.cmd --prefix apps/kalio-api run test -- architecture-agent-flow.adapter.spec.ts architecture-runtime.service.spec.ts
corepack pnpm --filter kalio-api run typecheck
```

Expected: all pass.

### Task 3: Native `run_sub_agentflow` Tool

**Files:**
- Create: `apps/kalio-api/src/modules/tool/tools/run-sub-agentflow.tool.ts`
- Create: `apps/kalio-api/src/modules/tool/tools/run-sub-agentflow.tool.spec.ts`
- Modify: `apps/kalio-api/src/modules/tool/tool.providers.ts`
- Modify: `apps/kalio-api/src/modules/tool/tool.module.ts`

- [ ] **Step 1: Write failing tool tests**

Test cases:

```ts
it('injects parentSessionId from the ToolCallRequest instead of trusting args', async () => {
  const runtime = { run: vi.fn().mockResolvedValue({
    flowRunId: 'flow-1',
    childSessionId: 'child-1',
    status: 'done',
    summary: 'done',
    decisions: [],
    nextActions: [],
    artifacts: [],
  }) };
  const tool = new RunSubAgentFlowTool(runtime as never);
  await tool.execute({
    sessionId: 'real-parent',
    toolName: 'run_sub_agentflow',
    callId: 'call-1',
    args: {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement',
      parentSessionId: 'spoofed-parent',
    },
  });
  expect(runtime.run).toHaveBeenCalledWith(expect.objectContaining({
    parentSessionId: 'real-parent',
  }));
});
```

Also test invalid `flowId`, blank `goal`, bounded `maxSteps`, default `returnMode`, and default `vfsMode`.

- [ ] **Step 2: Run failing tests**

Run:

```powershell
npm.cmd --prefix apps/kalio-api run test -- run-sub-agentflow.tool.spec.ts
```

Expected: missing tool.

- [ ] **Step 3: Implement tool**

Tool metadata:

```ts
@Tool({
  name: 'run_sub_agentflow',
  description: 'Launch a bounded child agent flow such as goal_guard_delivery_loop and return its summarized result.',
  parameters: {
    type: 'object',
    required: ['flowId', 'goal'],
    properties: {
      flowId: { type: 'string' },
      goal: { type: 'string' },
      context: { oneOf: [{ type: 'string' }, { type: 'object' }] },
      vfsMode: { type: 'string', enum: ['isolated', 'shared'] },
      copyBack: { type: 'boolean' },
      returnMode: { type: 'string', enum: ['summary', 'full_trace', 'artifacts_only'] },
      maxSteps: { type: 'integer' },
    },
  },
  requiresConfirmation: true,
})
```

Implementation rules:

- Inject `parentSessionId` from `request.sessionId`.
- Reject blank `goal`.
- Default `vfsMode` to `isolated`.
- Default `copyBack` to `false`.
- Default `returnMode` to `summary`.
- Cap `maxSteps` to a safe backend constant.

- [ ] **Step 4: Register provider and module dependency**

Add `RunSubAgentFlowTool` to `TOOL_PROVIDER_CLASSES`.

- [ ] **Step 5: Run tool tests and tool catalog tests**

Run:

```powershell
npm.cmd --prefix apps/kalio-api run test -- run-sub-agentflow.tool.spec.ts tool-registry.service.spec.ts tool.module.spec.ts
corepack pnpm --filter kalio-api run typecheck
```

Expected: all pass and `run_sub_agentflow` appears in the catalog.

### Task 4: Persisted Flow Run Projection

**Files:**
- Create: `apps/kalio-api/src/modules/agent-flow/agent-flow-run.repository.ts`
- Create: `apps/kalio-api/src/modules/agent-flow/agent-flow-run.repository.spec.ts`
- Modify: `apps/kalio-api/src/modules/agent-flow/architecture-agent-flow.adapter.ts`
- Modify: `apps/kalio-api/src/modules/architecture/architecture-parent-chat-projection.ts`

- [ ] **Step 1: Write repository tests**

Arrange: create a run with parent/child ids.
Act: save, update status, read by id and parent id.
Assert: state is immutable from caller mutation and unknown ids return `undefined`.

- [ ] **Step 2: Implement in-memory repository first**

Use an injectable repository with a `Map<string, AgentFlowRun>`. Do not add database migration until the contract is stable.

- [ ] **Step 3: Update adapter to save `running` then terminal state**

When architecture runtime starts, save:

```ts
{
  id: run.id,
  parentSessionId,
  childSessionId: run.rootSessionId,
  flowDefinitionId,
  status: 'running',
  returnMode,
  createdAt,
  updatedAt,
}
```

Then update to `done`, `failed`, `blocked`, or `cancelled`.

- [ ] **Step 4: Run tests**

Run:

```powershell
npm.cmd --prefix apps/kalio-api run test -- agent-flow-run.repository.spec.ts architecture-agent-flow.adapter.spec.ts architecture-parent-chat-projection.spec.ts
```

Expected: all pass.

### Task 4.5: Parent Projection Must Be One Flow Tool Result

**Files:**
- Modify: `apps/kalio-api/src/modules/architecture/architecture-parent-chat-projection.ts`
- Modify: `apps/kalio-api/src/modules/architecture/architecture-parent-chat-projection.spec.ts`

- [ ] **Step 1: Add regression test for one parent flow result**

Arrange an architecture run with multiple internal participant/router/finalizer events.
Act through the parent chat projection builder.
Assert the parent projection contains exactly one `run_sub_agentflow` tool result for the flow, not multiple fake `run_subagent` calls.

```ts
expect(messages.filter((message) => message.role === 'tool_result')).toHaveLength(1);
expect(messages[0]?.toolCalls?.[0]?.name).toBe('run_sub_agentflow');
expect(messages[1]?.content).toContain('"flowRunId"');
```

- [ ] **Step 2: Keep internal branch trace behind `tracePreview`**

The compact parent result may include a short `tracePreview`, but raw architecture branch scaffolding must stay in the child graph/chat view.

- [ ] **Step 3: Run projection tests**

Run:

```powershell
npm.cmd --prefix apps/kalio-api run test -- architecture-parent-chat-projection.spec.ts architecture-graph-projection.spec.ts
```

Expected: parent projection is one delegated flow result while graph projection still contains full child flow evidence.

### Task 5: Normalize Flow Events

**Files:**
- Create: `apps/kalio-api/src/modules/agent-flow/agent-flow-event-normalizer.ts`
- Create: `apps/kalio-api/src/modules/agent-flow/agent-flow-event-normalizer.spec.ts`
- Modify: `apps/kalio-api/src/modules/agent-flow/architecture-agent-flow.adapter.ts`

- [ ] **Step 1: Write normalizer tests**

Arrange architecture events for participant, router, finalizer, failed CLI child.
Act: normalize.
Assert output uses stable event names:

```ts
expect(events.map((event) => event.type)).toEqual([
  'flow:node_start',
  'flow:node_result',
  'flow:edge_taken',
  'flow:guard_result',
]);
```

- [ ] **Step 2: Implement normalizer**

Keep it pure. No Nest injection, no service access.

- [ ] **Step 3: Use normalizer for `tracePreview`**

Limit preview size to a small constant such as 20 events.

- [ ] **Step 4: Run tests**

Run:

```powershell
npm.cmd --prefix apps/kalio-api run test -- agent-flow-event-normalizer.spec.ts architecture-agent-flow.adapter.spec.ts architecture-graph-projection.spec.ts
```

Expected: all pass.

### Task 6: Parent Chat Flow Bubble

**Files:**
- Modify: `packages/@kalio/types/src/index.ts`
- Modify: `apps/kalio-web/src/features/chat/graph/executionGraphModel.types.ts`
- Create: `apps/kalio-web/src/features/chat/SubAgentFlowBubble.tsx`
- Create: `apps/kalio-web/src/features/chat/SubAgentFlowBubble.test.tsx`
- Modify the existing chat message renderer that handles `tool_result` messages.

- [ ] **Step 1: Add FE tests for flow bubble states**

Arrange a `tool_result` message whose content is a serialized `SubAgentFlowResult`.
Act render.
Assert it shows:

- flow name,
- terminal status,
- `Open chat`,
- `Open graph`,
- artifact count,
- blocked/failed next actions when present.

- [ ] **Step 2: Implement compact bubble component**

Use existing UI patterns. Do not add marketing-style cards. Keep it dense and operational.

- [ ] **Step 3: Wire renderer**

Only render the flow bubble when `toolName === 'run_sub_agentflow'` or a structured `subAgentFlow` field exists.

- [ ] **Step 4: Run FE tests**

Run:

```powershell
npm.cmd --prefix apps/kalio-web run test -- SubAgentFlowBubble.test.tsx executionGraphModel.test.ts
corepack pnpm --filter kalio-web run typecheck
```

Expected: all pass.

### Task 7: Execution Graph Child Execution Kinds

**Files:**
- Modify: `apps/kalio-web/src/features/chat/graph/executionGraphModel.types.ts`
- Modify: `apps/kalio-web/src/features/chat/graph/executionGraphModel.ts`
- Modify: `apps/kalio-web/src/features/chat/graph/executionGraphNodePresentation.ts`
- Modify: `apps/kalio-web/src/features/chat/graph/ExecutionGraphInspector.tsx`
- Add/update focused tests in the same folder.

- [ ] **Step 1: Write graph model tests**

Arrange one graph with:

- `sub_agent` node,
- `cli_agent` node,
- `sub_agentflow` node.

Act build model.
Assert each node keeps a distinct `childExecutionKind`.

- [ ] **Step 2: Implement typed graph metadata**

Do not infer `sub_agentflow` only from label text. Use structured metadata from backend projection when available.

- [ ] **Step 3: Update node presentation**

Use clear labels:

- `Sub-agent`
- `CLI agent`
- `Sub AgentFlow`

- [ ] **Step 4: Run graph tests**

Run:

```powershell
npm.cmd --prefix apps/kalio-web run test -- executionGraphModel.test.ts executionGraphNodePresentation.test.ts ExecutionGraphInspector.test.tsx ExecutionGraphBoard.test.tsx
```

Expected: all pass and no wheel/passive regression returns.

### Task 8: Two-Agent Goal Guard Flow Contract

**Files:**
- Modify: `apps/kalio-api/src/modules/architecture/architecture-seed-schemas.ts`
- Modify: `apps/kalio-api/src/modules/architecture/architecture-seed-schemas.deep.ts`
- Modify: `apps/kalio-api/src/modules/architecture/architecture-registry.service.spec.ts`
- Modify: `docs/sub-agentflow-target-architecture.md`

- [ ] **Step 1: Add registry tests for alias**

Arrange registry seed.
Act resolve `goal_guard_delivery_loop`.
Assert it returns the current Goal Master delivery schema or an explicitly renamed two-agent schema.

- [ ] **Step 2: Make the schema visibly two-agent**

The flow must have at least:

- Dev/Implementer node,
- Goal Guard node,
- route from Guard back to Dev when evidence is insufficient,
- terminal accept/block path.

It must not use Five Minds as the proof path.

- [ ] **Step 3: Run tests**

Run:

```powershell
npm.cmd --prefix apps/kalio-api run test -- architecture-registry.service.spec.ts architecture-runtime.service.spec.ts architecture-role-executor.spec.ts
```

Expected: all pass and test names mention two-agent Goal Guard, not Five Minds.

### Task 9: Full-Stack Mock E2E

**Files:**
- Create: `apps/e2e/tests/sub-agentflow-goal-guard.spec.ts`
- Modify: any existing E2E fixture helpers only if needed.

- [ ] **Step 1: Write Playwright E2E using mock providers**

Arrange:

- random API/web/storage ports,
- clean storage,
- mock LLM responses,
- `goal_guard_delivery_loop` selected from FE.

Act:

- open Kalio FE,
- start the task from the Architect or Talk UI,
- wait for Conversations and Execution Graph to update.

Assert:

- Conversations shows a fresh run within this test,
- graph has Dev/Implementer and Goal Guard nodes,
- no Five Minds nodes are used,
- terminal status is `done` only when Goal Guard evidence exists,
- screenshot saved.

- [ ] **Step 2: Run E2E**

Run:

```powershell
corepack pnpm --filter kalio-e2e run test -- sub-agentflow-goal-guard.spec.ts
```

Expected: Playwright passes and produces screenshots/traces.

### Task 10: Live Manual QA Through Kalio FE

**Files:**
- No code files unless a defect is found.
- QA evidence should be recorded in `docs/sessions/YYYY-MM-DD-sub-agentflow-live-qa.md`.

- [ ] **Step 1: Restart Kalio with dev-server tooling**

Use the existing managed Kalio service. Confirm API and web health.

- [ ] **Step 2: Use Playwright Orchestrator**

Manual QA flow:

1. Open `http://localhost:5188/`.
2. Navigate through the FE, not direct API calls.
3. Select `goal_guard_delivery_loop`.
4. Start a bounded mock or low-cost live run.
5. Open Talk > Conversations.
6. Open Execution Graph.
7. Capture screenshots.
8. Collect console/runtime signals.

- [ ] **Step 3: Assert final user-facing behavior**

Pass criteria:

- run appears as a current conversation, not stale 8h-old history,
- graph updates without freezing,
- no passive `preventDefault` wheel warning,
- graph displays Dev/Implementer and Goal Guard,
- parent result status does not say done while any child is unresolved,
- screenshots show the final page and graph evidence.

### Task 11: Documentation Cleanup

**Files:**
- Modify: `docs/spec/agent-architecture-design.md`
- Modify: `docs/sub-agentflow-target-architecture.md`
- Modify: `docs/application-architecture-current.md`
- Modify: `docs/tool-architecture.md`

- [ ] **Step 1: Make canonical docs unambiguous**

`docs/spec/agent-architecture-design.md` should be the source note or product intent. `docs/sub-agentflow-target-architecture.md` should be the implementation mapping. Add a one-line cross-link in both directions.

- [ ] **Step 2: Remove duplicate sections**

Keep one contract section, one phased delivery section, and one gap table.

- [ ] **Step 3: Add current status table**

Use:

| Capability | Status | Evidence |
| --- | --- | --- |
| Shared contracts | Planned | Task 1 |
| Native tool | Planned | Task 3 |
| Architecture adapter | Planned | Task 2 |
| FE graph kind | Planned | Task 7 |
| Live FE QA | Required | Task 10 |

- [ ] **Step 4: Run docs sanity check**

Run:

```powershell
rg "Five Minds is not a substitute|run_sub_agentflow|goal_guard_delivery_loop|ChildExecutionKind" docs AGENTS.md
```

Expected: target terms are present and Five Minds warning remains explicit.

---

## Migration Rules

- Do not rename `ArchitectureRuntimeService` in the first slice. Wrap it behind `AgentFlowRuntimePort`.
- Do not add database migrations until the in-memory `AgentFlowRun` contract passes FE/BE tests.
- Do not route two-agent QA through Five Minds.
- Do not trust caller-provided `parentSessionId`; inject it from the runtime request context.
- Do not mark a flow `done` if any linked CLI child status is missing, unknown, running, or failed.
- Do not use live CLI agents until mock E2E passes.

## Acceptance Criteria

- User can launch `goal_guard_delivery_loop` as `run_sub_agentflow` from a parent agent.
- System creates a child session and a first-class flow run.
- Parent chat receives a compact flow result with `flowRunId`, `childSessionId`, status, decisions, next actions, artifacts, and trace preview.
- Execution Graph distinguishes `sub_agent`, `cli_agent`, and `sub_agentflow`.
- Two-agent Dev/Implementer <-> Goal Guard loop can route back before final acceptance.
- FE and BE tests prove the flow cannot finalize while child CLI sessions are unresolved.
- Playwright full-stack mock QA proves Conversations and Execution Graph update from the UI.

## Recommended Commit Sequence

1. `feat(types): add agent flow delegation contracts`
2. `feat(api): wrap architecture runtime as agent flow adapter`
3. `feat(api): add run_sub_agentflow tool`
4. `feat(api): persist agent flow run projection`
5. `feat(web): render sub agentflow chat and graph metadata`
6. `test(e2e): cover goal guard sub agentflow`
7. `docs: map sub agentflow architecture to Kalio`

## Known Gaps Before Implementation

| Gap | Severity | Why it matters |
| --- | --- | --- |
| No native `run_sub_agentflow` tool | High | Parent agents cannot delegate to a nested flow through the same mechanism as other tools. |
| No explicit `AgentFlowRun` entity | High | UI/projections can drift or show stale/running state incorrectly. |
| Architecture naming leaks into product surface | Medium | The target concept is reusable nested agent flow, not only architecture experiments. |
| Two-agent flow name mismatch | Medium | `goal_guard_delivery_loop` and `goal-master-delivery-loop` need aliasing or migration. |
| FE QA can accidentally validate stale conversations | High | User-facing proof must start from FE and verify freshness. |
| Browser QA can stay outside the runtime contract | High | A flow can look `done` while Playwright Orchestrator still has high visual/focus/WCAG findings. |

## 2026-05-31 External QA Gate Update

Kalio now has a first runtime-level bridge between manual/browser QA and the two-agent loop:

- `.vscode/mcp.json` includes importable `mcp-dev-servers` and `mcp-playwright-orchestrator` entries for Settings -> MCP Servers -> Import Existing MCP Configs.
- `docs/examples/kalio-agent-qa-mcp.config.toml` documents the equivalent TOML-managed QA MCP profile.
- AgentFlow resume context is merged into the next runtime invocation.
- Goal Master finalization is blocked when `externalQualityGate` or `externalQualityGates` contains a failed/error/blocking gate or high-severity findings.
- Regression coverage proves failing Playwright evidence routes Goal Master back to Implementer instead of emitting `final_artifact`.

Architect FE now has a waiting-run action that takes Playwright QA evidence and posts it as structured AgentFlow resume context.

Full-stack mock E2E now covers the path:

- `apps/e2e/tests/agentflow-goal-guard.spec.ts`
- Command: `corepack pnpm --dir apps/e2e test:e2e -- agentflow-goal-guard.spec.ts`
- Result: 4 passed on a random-port mock stack.
- New scenario: FE starts a bounded Goal Guard flow, waits for `waiting_on_orchestrator`, submits Playwright QA evidence through the Architect UI, verifies `checkpoint.resumeContext.externalQualityGate`, and proves the run does not reach `done`.

Current UI evidence: Conversations/Talk renders the waiting Goal Guard AgentFlow bubble, exposes the QA next action and trace handoff details, Canvas shows the waiting flow preview, and Execution Graph remains openable for the child Goal Guard run. Remaining work is live manual QA against the managed FE with a real provider.

## 2026-05-31 Mock Runtime Test Review Update

Two independent review passes flagged that the first MockLLM Goal Guard tests were useful for prompt/routing smoke coverage but too dry to prove production runtime behavior because `dryGoalMasterLoopSchema()` converted `tool_executor` slots to participants.

Added stronger runtime scenario coverage:

- MockLLM reject-then-accept loop: proves return-to-implementer routing before final acceptance.
- MockLLM immediate accept: proves direct finalization path.
- MockLLM reject-forever: proves bounded failure with stop-event payload (`maxSteps`, `maxNodeVisits`, `pendingNodeIds`, `visitCounts`) and no final artifact.
- Production Goal Master schema with deterministic subagent tool events: keeps `materializer` and `verifier` as `tool_executor` slots and asserts `vfs_write`, `vfs_read`, and Goal Master tool evidence before finalization.

Latest E2E coverage:

- `apps/e2e/tests/agentflow-goal-guard.spec.ts` starts the dedicated Goal Guard AgentFlow from the Architect UI on the random-port mock stack.
- The completed path asserts the graph shows `Implementer` and `Goal Master`, rejects `Five Minds`, renders the executed route, attaches graph/chat screenshots, and verifies final chat evidence.
- The failure-first path starts a prose-only Goal Guard run through the API and proves it does not reach `done` without materialization evidence.

## 2026-05-31 Checkpoint Envelope Update

Implemented a first durable checkpoint envelope on `AgentFlowRun`:

- `checkpoint.goal`
- `checkpoint.context`
- `checkpoint.vfsMode`
- `checkpoint.copyBack`
- `checkpoint.maxSteps`
- `checkpoint.lastResumeInput`
- `checkpoint.resumeContext`

This is not full graph-node continuation yet. It does mean durable resume no longer reconstructs adapter args from a synthetic `Resume AgentFlow run <id>` prompt. The next resume slice should persist the exact waiting node, route cursor, and node execution state needed to continue after process restart.

Verified:

- `npm.cmd --prefix packages/@kalio/types run test -- contracts.test.ts`
- `npm.cmd --prefix apps/kalio-api run test -- src/modules/agent-flow/agent-flow-runtime.service.spec.ts src/modules/agent-flow/agent-flow-run.repository.spec.ts src/modules/agent-flow/architecture-agent-flow.adapter.spec.ts`
- `corepack pnpm --filter @kalio/types run typecheck`
- `corepack pnpm --filter @kalio/types run build`
- `corepack pnpm --filter kalio-api run typecheck`
- `npm.cmd --prefix apps/e2e run test:e2e -- agentflow-goal-guard.spec.ts`

## 2026-05-31 Continuation Cursor TDD Update

Added red-green coverage for the next resume stabilization layer:

- `AgentFlowCheckpoint.continuation` records why a bounded flow paused, the waiting node, pending nodes, visit counts, last completed node, and last route.
- Architecture max-step stop events now project to `AgentFlowRun.status = waiting_on_orchestrator` with `waitingForNodeId`, `activeNodeIds`, `nodeVisitCounts`, and checkpoint cursor.
- Resume now preserves `lastResumeInput`, `resumeContext`, raised `maxSteps`, and existing continuation data when a refreshed architecture snapshot is still waiting.
- `AgentFlowRuntimeService.resume` now calls an adapter `resume` hook when available, instead of being limited to stale snapshot refresh.

Verified:

- RED: `npm.cmd --prefix apps/kalio-api run test -- src/modules/agent-flow/agent-flow-runtime.service.spec.ts -t "keeps resume checkpoint updates"` failed because refresh overwrote resume checkpoint updates.
- GREEN: same command passed after merging refreshed snapshots with the updated resume checkpoint.
- RED: `npm.cmd --prefix apps/kalio-api run test -- src/modules/agent-flow/agent-flow-runtime.service.spec.ts -t "delegates resume"` failed because adapter `resume` was never called.
- GREEN: same command passed after adding continuation-capable adapter delegation.
- `npm.cmd --prefix packages/@kalio/types run test -- contracts.test.ts`
- `npm.cmd --prefix apps/kalio-api run test -- src/modules/agent-flow/architecture-agent-flow.adapter.spec.ts src/modules/agent-flow/agent-flow-runtime.service.spec.ts src/modules/agent-flow/agent-flow-run.repository.spec.ts`
- `corepack pnpm --filter @kalio/types run typecheck`
- `corepack pnpm --filter @kalio/types run build`
- `corepack pnpm --filter kalio-api run typecheck`

Remaining critical gap:

- `ArchitectureAgentFlowAdapter.resume` now calls an architecture runtime continuation hook when available and passes the stored continuation cursor. The runtime re-enters execution with resume context and step budget, but it still reruns the graph with cursor context rather than replaying exactly from one node-local continuation frame.

## 2026-05-31 Architecture Flow Stabilization Update

Bug-hunter RED tests exposed and this pass fixed these backend blockers:

- duplicate AgentFlow event IDs were visible in memory before restart;
- nested checkpoint JSON was shallow-cloned and caller mutation could leak into stored runs;
- durable reload dropped lifecycle fields needed by status APIs (`maxIterations`, `returnToOrchestratorCount`, `summary`, `finishedAt`);
- `getSnapshot()` refresh could drop stored checkpoint constraints;
- max-node-visit stops could end without a terminal guard event;
- `run_sub_agentflow` could launch with an empty parent session id;
- AgentFlow create API accepted orphaned/invalid payloads;
- there was no parent-session listing method for Conversation visibility.

Current verified behavior:

- bounded max-step and max-node-visit stops emit guard evidence with pending nodes and visit counts;
- AgentFlow waiting state carries `waitingForNodeId`, `activeNodeIds`, `nodeVisitCounts`, and `checkpoint.continuation`;
- resume preserves checkpoint data, passes continuation args to adapters, and can re-enter architecture execution through `ArchitectureRuntimeService.resumeRun`;
- Architect FE shows `waiting_on_orchestrator`, AgentFlow summary, and a Resume AgentFlow affordance instead of collapsing paused flows into generic `running`.

Verified:

- `npm.cmd --prefix apps/kalio-api run test -- src/modules/agent-flow/architecture-agent-flow.adapter.spec.ts src/modules/agent-flow/agent-flow-runtime.service.spec.ts src/modules/agent-flow/agent-flow-run.repository.spec.ts src/modules/agent-flow/agent-flow-runs.controller.spec.ts src/modules/tool/tools/run-sub-agentflow.tool.spec.ts src/modules/architecture/architecture-graph-runtime.max-visits.spec.ts`
- `npm.cmd --prefix packages/@kalio/types run test -- contracts.test.ts`
- `corepack pnpm --dir apps/kalio-web test -- src/features/architect/ArchitectPage.test.tsx`
- `corepack pnpm --filter @kalio/types run typecheck`
- `corepack pnpm --filter @kalio/types run build`
- `corepack pnpm --filter kalio-api run typecheck`
- `corepack pnpm --filter kalio-web run typecheck`

Do not run the real `C:\Projekty\TurboProject2` project flow until the mock FE/API resume path is covered by an E2E test that starts a waiting flow, resumes it, and observes completion.

## 2026-05-31 Full-Stack Mock E2E Update

Verified the current AgentFlow contract through the full mock stack:

- `npm.cmd --prefix apps/e2e run test:e2e -- agentflow-goal-guard.spec.ts`
- Result: `3 passed`.
- Stack evidence: backend build, frontend build, random API/web ports, mock LLM config, Architect UI start, graph/chat screenshot attachments, and API resume path.
- Failure-first evidence: prose-only materialization did not produce a `done` AgentFlow result.
- Resume evidence: bounded `maxSteps: 2` run reached `waiting_on_orchestrator` with `checkpoint.continuation`, then `POST /api/agent-flows/runs/:id/resume` completed the same AgentFlow run and retained the `flow:resume_input` event.

Resolved blocker before real project execution:

- `architecture-runtime.service.spec.ts` now passes with settled CLI-child status semantics: continuation-capable max-node-visit stops stay `running`, hard max-step exhaustion stays `failed`, and AgentFlow projects continuation stops as `waiting_on_orchestrator`.
- `run_sub_agentflow` is wired into the executable chat dispatch registry, not only the tool provider/catalog list.

Remaining gate before claiming production-complete:

- Run live manual QA from Kalio FE on a fresh `C:\Projekty\TurboProject2` branch, capture Conversations/Execution Graph/final website screenshots, and verify the generated project build.

## 2026-06-01 Readiness Gate Update

The local non-paid gate is currently green:

- `kalio-api` typecheck passed.
- `kalio-api` build passed.
- `kalio-web` typecheck passed.
- `kalio-web` build passed, with only the existing Vite chunk-size warning.
- `corepack pnpm --filter @kalio/e2e run test:e2e -- agentflow-goal-guard.spec.ts` passed with 11 tests on a random-port mock stack.
- `kalio-api` coverage: statements 87.64%, branches 80.94%, functions 89.45%, lines 87.64%.
- `kalio-web` coverage: statements 80.98%, branches 73.09%, functions 79.78%, lines 82.97%.

The paid/live real-project proof is still blocked:

- Managed Kalio API now reports DB-backed Xiaomi provider state after local credential activation, but the provider credential itself does not authenticate.
- `npm.cmd run agentflow:activate-live-credential -- --provider xiaomimimo --model mimo-v2.5-pro --base-url https://token-plan-ams.xiaomimimo.com/v1` can seed and activate a DB-backed Kalio credential from ignored `.env.test` without printing the key.
- `npm.cmd run agentflow:paid-readiness` is the executable pre-paid gate. It now validates the active DB credential through Kalio's provider-test endpoint and currently fails for one blocker: Xiaomi returns `Invalid API Key`.
- Do not run the paid `C:\Projekty\TurboProject2` proof until the active provider credential passes `npm.cmd run agentflow:paid-readiness`.
