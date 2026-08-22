# Kalio Project Spec

Last updated: 2026-08-03

This file records durable product and architecture decisions that should guide agents across sessions. Session notes in `docs/sessions/` describe what changed; this file describes the boundaries that should remain true.

## Runtime Source Of Truth

- Backend durable runtime state is the source of truth for chat, workflow, AgentFlow, CLI children, tool approvals, HITL, and reconnect/F5 recovery.
- Frontend may render projections, but it must not infer runtime routing, terminal state, retryability, or approvals from prose, prompt text, message ids, tool-call id prefixes, or UI-local timers.
- Runtime decisions use typed status, reason code, error code, evidence, structured output, and durable event history.
- Display text can explain a decision, but changing display text must not change system behavior.

## Canonical Runtime Contract

- A workflow run is an append-only, durable sequence of typed runtime events. Each event has a run id, monotonically increasing sequence, event id, timestamp, correlation ids (`sessionId`, `turnId`, `nodeId`, `toolCallId`, or `waitId` where applicable), lifecycle status, and typed reason/error fields.
- The backend commits an event before publishing its projection. REST recovery and Socket.IO publish the same complete, versioned snapshot. Incremental chunks are display overlays and cannot mutate lifecycle status.
- The frontend accepts a runtime snapshot only when it has a greater server-authoritative `revision` than its stored projection. A terminal status cannot regress to non-terminal state within a run.
- Workflow, node, chat-turn, child execution, and HITL waits project from durable records. UI-local `done`, message order, clock time, id patterns, and transcript content are never lifecycle sources.

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> running
  running --> waiting_for_human
  waiting_for_human --> running: approve / continue
  waiting_for_human --> cancelled: deny / user_stop / system_stop
  running --> completed
  running --> failed
  running --> blocked
  queued --> cancelled
  completed --> [*]
  failed --> [*]
  blocked --> [*]
  cancelled --> [*]
```

- Every terminal state has a typed `reasonCode`; failed states additionally carry `errorCode` or `failure`.
- Manual tool, RA-App, and budget approvals are durable unbounded waits. They end only through an explicit decision, a user/system stop, or typed workflow cancellation.

```mermaid
flowchart LR
  Chat["Chat Session"] --> Turn["Agent Turn"]
  Turn --> Node["Workflow Node"]
  Node --> Event["Typed Runtime Event"]
  Event --> Store["Durable event journal"]
  Store --> Projection["Revisioned runtime snapshot"]
  Projection --> UI["Talk / Canvas / Session Panel / Execution Graph"]
```

## Chat And Workflow Model

- Provider and model form one execution pair. An AgentFlow persona must not silently replace only the model on an unrelated active provider. Without an explicit run-level model override, workflow branches inherit the active provider configuration used by chat.

- A chat is composed of turns. The canonical run lifecycle is `queued`, `running`, `waiting_for_human`, `completed`, `failed`, `blocked`, or `cancelled`; unknown or legacy status must not be projected as success.
- The latest active/terminal turn influences the chat status, but chat-level recovery may retry transport/provider failures through typed policy.
- Workflow nodes call child chat sessions; child sessions execute turns. Nodes and connections orchestrate at a higher level and must consume child typed states, not child transcript prose.
- CLI agents, subagents, and AgentFlow children are one child-execution family for lifecycle, visibility, stop, replay, and status projection.
- Terminal events are scoped to their `runId` and `turnId`; a terminal event for an older turn must not complete or clear a newer turn.

```mermaid
flowchart TD
  Workflow["Workflow Run"] --> Node["Workflow Node"]
  Node --> ChildChat["Child Chat Session"]
  ChildChat --> Turn["Agent Turn"]
  Turn --> LLM["LLM / Tool Loop"]
  LLM --> Done["completed"]
  LLM --> HITL["waiting_for_human"]
  LLM --> Failed["failed"]
```

## Structured Output And Handoff

- Router, judge, and finalizer control flow must prefer provider-native structured output/schema.
- If a model must return a decision, use structured output. Do not parse `message.includes`, prose JSON blocks, or status words from assistant text.
- Router/parent nodes pass downstream context as typed handoff packets derived from `ArchitectureRouterOutput`: target, action, confidence, accepted inputs, rejected inputs, conflicts, risks, and response.
- `routerOutput.nextAction` is the control contract. Only `route_to` may become a downstream route call; `ask_human` and other pause actions may keep `targetNodeId` as context, but must not emit route hops or selected downstream nodes.
- A visible handoff bubble is display-only. The actual route is selected from typed `routerOutput` and graph edges.

## External Structured LLM API

- Kalio may serve product-specific local applications through `POST /api/v1/llm/structured`; Kalio remains the sole owner of provider credentials, active provider/model selection, generation limits, and provider error normalization.
- External callers provide bounded text messages and a bounded JSON Schema. They never receive provider credentials or an endpoint that executes tools.
- The endpoint is disabled until `KALIO_EXTERNAL_API_TOKEN` is configured. Every caller, including loopback callers, must send the matching bearer token.
- A product-specific caller owns its domain prompts and validates the returned object against its own semantic/domain boundary before using it.
- An external structured request is not a chat turn, workflow run, or durable child execution. It must not fabricate chat/session lifecycle evidence or mutate runtime projections.

## Data Analyst MCP Boundary

- Data Analyst is a session-scoped data and artifact engine exposed through
  authenticated Streamable HTTP MCP. Kalio, Codex, and other agents own
  investigative reasoning and final narrative; DA owns dataset access,
  deterministic computation, durable analysis history, replay, and report UI.
- The native workflow is composable: create a document-scoped session, profile
  datasets, query bounded SQL, search text, inspect relationships, read/replay
  immutable artifacts, and publish an agent-authored report.
  `data_analyst_run_analysis` is compatibility-only.
- Every session pins exact dataset fingerprints. Every operation appends an
  immutable artifact containing its inputs, outputs, timestamps, and lineage,
  so the analysis can be audited and replayed without reconstructing it from
  chat prose.
- Raw SQL access is disabled by default and is allowed only for a trusted local
  agent through explicit runtime configuration. It remains read-only,
  dataset-scoped, parsed, and bounded. Raw artifacts cannot be embedded in
  report snapshots.
- `.kalio/config.toml` is the canonical repo-managed Kalio MCP registration.
  Provider-facing MCP tool names must be deterministic, collision-resistant,
  and compatible with OpenAI-style function-name constraints; legacy names are
  aliases only.

```mermaid
classDiagram
  ArchitectureExecutionEvent --> ArchitectureRouterOutput
  ArchitectureRouterOutput --> ArchitectureRouterInsight
  ArchitectureRouterOutput --> ArchitectureRouterRisk
  ArchitectureExecutionEvent --> WorkflowEvidence

  class ArchitectureRouterOutput {
    selectedStrategy
    mergedDecision
    acceptedInputs
    rejectedInputs
    unresolvedConflicts
    risks
    confidence
    nextAction
    targetNodeId
    response
  }
```

## LLM History Boundaries

- Persisted conversation history remains complete for UI, audit, and recovery, including prompts whose turns failed or were cancelled.
- Provider context excludes every message owned by a terminal `failed`, `cancelled`, or `interrupted` chat run. Selection uses the durable `turnId -> chat_runs.status` relation; text, message wording, and elapsed time are forbidden inputs.
- `completed`, active, `waiting_for_human`, and safely recoverable turns remain eligible for provider context. Legacy messages without a durable `turnId` remain visible through the compatibility path until migrated.
- A later successful turn must never answer unresolved prompts from terminal failed turns or attach those answers to the new turn's `promptMessageId`.
- Persona/slot model selection is a request-scoped override of the active credential model. Paid readiness must prove the effective model used by the tested persona/slot, not only the global credential model.

## Durable Chat Queue

- A queued chat turn is persisted before `chat:queued` is emitted.
- Queue identity remains stable across enqueue, dequeue, restart, and execution: `runId`, `turnId`, and `clientMessageId` are not regenerated.
- Dequeue is a compare-and-swap transition from `queued` to `active`; FIFO order is durable and deterministic.
- Session identification bootstraps pending queued turns from the backend journal. Fixed-duration waits are not a recovery mechanism.
- Unknown or legacy lifecycle values never project as success; they remain unresolved until explicitly mapped.

## HITL And Budgets

- Manual HITL waits are durable and do not expire by timeout. They end only by approve, deny, explicit user/system stop, or workflow cancellation.
- Tool confirmation state and its typed continuation cursor must survive backend process restart. Approval uses CAS before dispatch, commits one durable tool result, and resumes the same turn and iteration budget; denial uses CAS and cannot leave an orphaned pending request.
- Chat and subagent continuations share the typed cursor contract, but a chat journal `runId` must not be fabricated for subagent runtime. Runtime-specific journal behavior is selected from `runtimeKind`.
- A resumed child turn is not sufficient proof that its parent workflow resumed. Parent orchestration must persist an explicit wait id and graph continuation cursor; after restart it must continue from the waiting node exactly once rather than recreate the child or restart root nodes.
- Human approval and tool-budget requests emitted by a workflow child create a typed `runtime_pause` continuation for the active parent node. Recovery must claim the persisted AgentFlow snapshot with a revision lease before doing work.
- A recovery lease provides single-owner execution, not side-effect exactly-once. Parent recovery must not replay an active node until the child turn result is durably addressable by a stable idempotency identity; replaying the root graph or starting a second child turn is forbidden.
- A child HITL continuation carries `requestId`, `childSessionId`, `childTurnId`, and `promptMessageId`. Completed subagent turns persist their text, structured output, and terminal message id in the chat-run journal; parent replay consumes that outcome by child turn id before any LLM call.
- Parent recovery uses two deterministic triggers: a bootstrap scan for outcomes committed while offline and an in-process completed-turn journal event for outcomes committed after startup. Fixed-duration polling is not a runtime mechanism; revision lease CAS elects one recovery owner.
- Tool budget exhaustion is a typed HITL request. It must appear from durable runtime evidence after reload/reconnect, not only from live socket timing.
- Need Attention should prioritize active approvals before historical notices.
- Live budget/HITL verification must use tools actually exposed to the tested node. A test must not prompt for hidden tools and then treat the model's refusal as a runtime failure.

## QA And Release Boundaries

- No release-ready claim without focused regressions, typecheck/build where affected, and FE-first workflow proof.
- Fixed waits are not architecture fixes. Tests may use bounded waits only as diagnostics or web-first waiting; production runtime correctness must use typed state, explicit lifecycle events, durable snapshots, or ack/drain barriers.
- Live-provider proof must use system Node on Windows and record effective provider/model evidence.
- Comprehensive workflow release coverage runs only against the mock provider. Paid proof is a separate, explicit single-node/no-tool canary with no project path or project memory/browser/prior-decision context, an exact provider/model guard, temporary output-token cap, settings restore, FE-first Talk start, and reconnect/F5 verification.
- Live tool proof is a second, separately confirmed canary limited to one manually approved `fs_write` under an explicit disposable allowed path. It must cap model iterations, block hidden title generation, verify the real file and F5 hydration, remove its own artifact, and restore allowed-path, HITL, and generation settings.

## Desktop Distribution And Updates

- The desktop app embeds the Tauri updater; a separate launcher is not part of the product runtime.
- GitHub Releases is the distribution source for public Windows/Linux builds. The `main` branch stores source and release configuration, never binary installers or private signing keys.
- Tagged CI releases publish signed Windows NSIS and Linux AppImage updater artifacts, their `.sig` files, and a generated `latest.json` manifest. The updater trusts the embedded Tauri public key and uses the GitHub `latest.json` endpoint.
- The updater check is non-blocking and user-confirmed. Network, missing release configuration, or signature-check errors must leave normal Kalio startup usable; installation only proceeds through an explicit user action and ends with a relaunch.
- The current manifest supports `windows-x86_64` and `linux-x86_64`. macOS remains a separate signing/notarization and updater-release scope.

## Primary Database Migration Boundary

- The primary Kalio SQLite schema changes only through ordered Drizzle migrations.
- Migration or required-schema validation failure is fatal to API startup; bootstrap must never run compatibility `ALTER TABLE` or silently repair primary database state.
- A stale, interrupted, or manually altered primary database requires an explicit backup-and-reset operation or a separately invoked one-time upgrade tool. Runtime startup must not decide or perform that recovery.

## Runtime And SQLite Distribution

- The release runtime uses Node.js with the platform-native `better-sqlite3` addon by default; standalone packaging must include the compiled addon and prove startup from the extracted archive.
- The API owns one SQLite runtime adapter. Node and Bun drivers share the adapter contract, while driver selection is process-wide and cannot change after initialization.
- `KALIO_SQLITE_DRIVER=auto` is the default. `KALIO_SQLITE_DRIVER=bun` is an opt-in experimental path validated for source/runtime smoke tests; it is not yet the public compiled-executable release lane.
- Bun is a candidate for a smaller executable and lower runtime overhead, but native `sharp`, `sqlite-vec`, and other platform modules require explicit sidecar/bundle validation before Bun becomes the release default.
- The backend serves the built web UI and API from one HTTP port in the standalone runtime. Host-binding policy remains a separate verification gate because bootstrap metadata and the actual `listen` call must agree.

## Agent Runtime And Codex Boundary

- Persona identity is independent from execution engine. Projects, personas, and sessions select a persisted `ExecutionProfile`; the direct LLM profile remains available and Codex profiles use the ChatGPT/Codex App Server.
- Kalio owns the durable `ChatSession`, run journal, tool policy, HITL, scheduler, and audit record. A Codex thread is an external runtime binding, not a second source of truth.
- The API keeps one long-lived Codex App Server process per auth/trust profile. Sandbox and approval settings are sent at thread/turn scope; permission modes must not create one process per agent.
- Codex dynamic tools are declared at `thread/start` and are dispatched through Kalio's existing tool broker/policy path. Native Codex tools remain Codex-native; their approval can use Codex auto-review (`codex_guard`) or Kalio HITL (`kalio_strict`).
- Kalio starts the Codex App Server with inherited `mcp_servers` disabled by default, so MCP entries from the user's global Codex profile are not silently exposed to a Kalio persona. `KALIO_CODEX_INHERIT_MCP=true` is an explicit opt-in for a trusted integration; Kalio's own MCP visibility remains controlled separately by the persona `mcpPolicy` (`allow_all`, `deny_all`, or `allow_list`).
- Active execution is bounded by the shared runtime scheduler, defaulting to five leases across foreground, control, and child agents. Child agents are not an unbounded second process class.
- External security/auto-check evaluation is a no-tools model call selected by the configured evaluator persona/profile. Its typed result preserves `allow`, `deny`, and `ask_user`; critical-risk actions always retain the human gate.
- Codex `thread/resume` currently cannot replace dynamic tool definitions. Until fingerprint mismatch handling is implemented, changing a session's effective toolset requires an explicit fresh thread/rebinding decision.
