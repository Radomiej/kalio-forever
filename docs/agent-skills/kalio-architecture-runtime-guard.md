# Kalio Architecture Runtime Guard Skill

Installed skill path:

```text
C:\Users\Radomiej\.codex\skills\kalio-architecture-runtime-guard\SKILL.md
```

This repository copy records the expected behavior for agents that only read repo docs.

## Core Rule

Treat Kalio architecture and appflow changes as runtime-contract work, not local UI patching. Backend owns durable truth; frontend renders a rebuildable projection.

## When To Use

- You are changing chat runtime, reconnect/F5 hydration, queueing, interrupt/stop, session activation, or child-session visibility.
- You are touching Execution Graph, Canvas, Session Panel, Talk view, or RA-App launch paths and the behavior depends on the same runtime lifecycle.
- You are adding a new child execution type, launch surface, runtime status, or socket lifecycle event.
- You suspect the bug comes from multiple competing state paths rather than one isolated component bug.

## Architecture Guardrails

- Start from the shared contract in `packages/@kalio/types`; do not invent a second FE/BE protocol when the existing runtime snapshot can be extended.
- Keep `session:runtime_snapshot` and runtime-aware selectors as the primary read path. If a fallback is necessary, hide it behind store/selectors and mark it with `TODO: legacy fallback`.
- Unify child work as one model. CLI children, subagents, and AgentFlow descendants should project into one child-execution view whenever lifecycle/status/rendering logic is shared.
- Treat Socket.IO recovery as best-effort only. Reconnect must still re-identify watched sessions and rebuild state from backend snapshots.
- `chat:stop` is not complete until the active root and descendants are drained and a terminal runtime snapshot lands. Do not rely on fire-and-forget stop semantics.
- `chat:stop` must stop active `ArchitectureRuntime` runs through `ARCHITECTURE_RUNTIME_STOP` / `ArchitectureRuntimeStopPort` for the root session and descendant session tree before terminal snapshots are trusted.
- Manual HITL approvals are durable waits, not timed failures. Tool and RA-App approvals may end only by approve, deny, user/system stop, or explicit workflow cancellation.
- RA-App approvals must be projected into Need Attention from the backend durable pending snapshot; parsing active transcript messages is only a fallback for already loaded sessions.
- Global RA-App approve/deny actions must identify/watch the owning session before emitting socket events, because backend approval handling enforces socket session ownership.
- RA-App inline pending overlays must settle only from typed approval resolution (`raapp:native_result`, approval id, session id) or refreshed durable state, never from display text.
- Runtime lifecycle observability must emit typed `runtime_event` rows with stable `eventName`, status, reason/error code, and IDs. Do not use prompt/message text as the audit contract.
- Durable graph reconstruction must prefer typed event fields such as `architectureEventId` / `eventId` and treat `toolCall.id`, `sessionId`, and message ids as opaque identifiers, not state machines or event classifiers.
- Malformed structured output from architecture router/finalizer paths is a typed `CONTRACT_VIOLATION`, not a routing hint. Persist the failed run, expose node-level `errorCode/failure` in graph projection, and cancel downstream nodes instead of leaving finalizer/children pending.
- Structured-output tests should validate the contract schema shape directly. Do not prove router/finalizer correctness by accepting prose that merely contains JSON-like text.
- Mock-provider regressions must mirror real dispatcher history: assistant `toolCalls[]` can contain tool name/args, but persisted `tool_result` messages may contain only `toolCallId` plus bare result JSON.
- LLM-history sanitization must preserve typed control metadata for runtime tool results. Oversized AgentFlow results may omit heavy trace data, but the sanitized content must remain parseable JSON with `flowRunId`, `childSessionId`, status, and related control fields.
- Runtime endpoints should live in the module that owns the runtime dependency. Do not create circular module imports for a controller method; split the controller or shared types instead.
- Pure workflow schema/DTO validation and clone logic should stay in standalone utilities, not inside `ArchitectureRuntimeService`. The service should orchestrate durable runtime state, not own contract-shape parsing.
- Typed audit-recovery derivation should stay in `architecture-runtime-audit-recovery.utils.ts`. The runtime service may fetch audit rows, but status/prompt/mode/field decoding should remain pure and directly tested.
- Runtime context payload shaping should stay in `architecture-runtime-context.utils.ts`. The runtime service may read injected VFS/CLI dependencies, but shaping CLI preferences and bounded VFS evidence should remain pure and directly tested.
- Architecture graph finalization and materialization checks should stay in `architecture-graph-finalization.utils.ts`. `ArchitectureGraphRuntime` should orchestrate node execution, not own blocking finalization, visible proof, external QA gate, or tool-executor contract parsing.
- Architecture graph routing selectors should stay in `architecture-graph-routing.utils.ts`. `ArchitectureGraphRuntime` should call typed helpers for outgoing selection, default/converge/continuation edges, structured `route_to` targets, and routing display messages.
- Architecture branch stream event projection should stay in `architecture-graph-branch-events.utils.ts`. `ArchitectureGraphRuntime` should emit projected events, not parse child stream payloads inline.
- Architecture graph topology/resume selectors should stay in `architecture-graph-topology.utils.ts`. `ArchitectureGraphRuntime` should call typed helpers for root nodes, edge grouping, active incoming reconstruction, node readiness, return-to-orchestrator pause routing, and selected-node recovery.
- Architecture graph scheduling and runtime-limit decisions should stay in `architecture-graph-scheduler.utils.ts`. A pending node that is already at `maxArchitectureNodeVisits` must produce a typed `max_node_visits` terminal decision when no executable work remains, not disappear from the ready queue.
- Goal Master judge continuation guard decisions should stay in `architecture-graph-judge-guard.utils.ts`. Runtime orchestration should pass typed finalization input/events into the helper, not inline proof/QA/continuation routing rules.
- Recoverable architecture node error fallback decisions should stay in `architecture-graph-recoverable-error.utils.ts`. Runtime orchestration should pass schema/node/error/incoming/outgoing context into the helper, then emit the typed decision event; it must not rebuild fallback routes inline from display text.
- Architecture role execution budget selection should stay in `architecture-role-execution-budget.utils.ts`. The default max tool attempts for architecture subagents is `30`, with typed priority `node -> persona -> context -> global saved setting -> default`, clamped to `1..100`.
- Child session previews must preload or hydrate persisted child history through the shared session history path; do not show a permanent waiting preview when backend history already has messages.
- Focused AgentFlow Canvas must render from the live `run_sub_agentflow` runtime activity before the matching persisted tool-result message exists, and from persisted history after F5/reload.
- Launch surfaces should converge on one activation path. Home tiles, composer flows, graph actions, and RA-App entrypoints must create a typed intent and use the same session activation logic.
- Root workspace gates must own package orchestration. Package `build`/`typecheck` scripts should call local tools such as `tsc`, not nested `pnpm`/`npm` commands that can mutate or re-resolve workspace dependencies during a root gate.
- Runtime E2E and release gates should inspect the scoped session tree for the active host (`GET /api/sessions/:id`, `GET /api/sessions/:id/children`) instead of listing global `/api/sessions` and filtering client-side.
- Playwright API retries may cover retryable transport resets while a live workflow is active, but must not retry or hide HTTP 4xx/5xx, typed runtime failures, or failed assertions.
- Persisted chat history used by tests, fixtures, and migrations should include durable `turn_id` and `prompt_message_id` for assistant messages. Chronological turn reconstruction is a legacy fallback, not a test contract.
- A host chat can contain multiple architecture workflow envelopes after follow-up runs. Reload/F5 hydration must collect and project every persisted `architectureRun` by `runId`; never infer host workflow state from only the last `architectureRun` message.
- Built QA/release browser gates that reuse an already running random-port stack must refresh the built frontend `runtime-config.js` from the authoritative stack state before opening the app. Do not rely on static frontend/backend port pairs for Socket.IO or API origin.
- Vite dev/preview runtime config must be served from the running process environment. Treat the shared built `dist/runtime-config.js` as a fallback for non-Vite static serving only; concurrent fixed/random-port QA stacks must not overwrite each other's API/WS origins.
- Release gates that inspect runtime persistence must pass the managed QA `DATABASE_PATH` into Playwright or any helper process. A browser test reading the default DB is not valid runtime evidence.
- E2E helpers that select or activate sessions must fail on explicit reconnect/transport banners before reporting missing rows. A transport failure is not the same bug as a missing session item.
- E2E helpers should use the active connection status as the readiness gate. Persistent recovery notices are diagnostic display state and must not block session selection once the socket is active.
- Runtime Attention tests must seed typed runtime evidence (`tool_result` error code/message, runtime snapshot, or graph projection). Assistant prose may be present for display, but must not be the assertion source for failure classification.
- Talk-started `run_sub_agentflow` reload may project through `ArchitectureRunTimeline` and Execution Graph rather than `SubAgentFlowResultBlock`. Tests should assert durable API snapshot plus visible graph/timeline projection, not a specific historical bubble component.
- Session-history tests must distinguish the active selected session history request from child/preload history requests. Active chat history uses the full active-session window; child previews may use smaller bounded preload windows.
- Stop/cancellation tests need deterministic long-running work such as mock `hold(ms)`. Do not rely on naturally slow LLM/tool behavior or racing a fast mock response.
- Full workflow release evidence should run against a freshly rebuilt or explicitly verified managed QA stack. A long-lived manual stack with stale sockets or hundreds of old sessions is useful for diagnosis, not for final release proof.
- Workflow release gates should start from a fresh mock QA stack by default. Use `--reuse-stack` only when explicitly diagnosing stale-stack or reconnect behavior.

## Design Moves

- Prefer moving truth toward `runtimeActivitySnapshots`, selectors, and projector/store helpers.
- Prefer deleting panel-local lifecycle heuristics after the shared runtime path exists.
- Prefer FE-first validation: Talk, Session Panel, Canvas, and Execution Graph should agree on the same runtime state.

## Anti-Patterns

| Mistake | Better move |
|---|---|
| Fixing one panel with a local state map | Extend the shared runtime contract or selector. |
| Trusting stale `session:status` over a newer runtime snapshot | Treat runtime snapshot as authoritative and keep status as fallback only. |
| Stopping only the chat pipeline, CLI, or AgentFlow while `ArchitectureRuntime` keeps running | Route stop through the architecture stop port and assert typed `cancelled` / `user_stop` state. |
| Adding a new child-run shape for each tool family | Project child work into one `childExecutions` model. |
| Proving runtime only with API polling | Start from Kalio FE and verify UI/runtime parity there. |
| Letting HITL expire while waiting for a human | Keep the request pending and surface it in Need Attention until explicit resolution. |
| Hiding RA-App approvals unless their chat transcript is loaded | Hydrate pending RA-App approvals from the durable backend snapshot and merge transcript-derived approvals as a fallback. |
| Emitting RA-App approve/deny from a global inbox without session ownership | Identify/watch the approval's session before emitting the socket command. |
| Keeping an inline RA-App overlay pending after typed approval execution | Settle the overlay from `raapp:native_result` matching the session and approval id. |
| Logging `error.message` or prompt content as the runtime source of truth | Log typed `runtime_event` names and reason/error codes; keep text display-only. |
| Parsing `toolCall.id`, `sessionId`, or message-id prefixes to infer graph state | Add explicit typed fields and use raw ids only as opaque compatibility fallbacks. |
| Treating malformed structured-output text as a fallback router decision | Fail with typed `CONTRACT_VIOLATION`, project the failed node, and cancel downstream nodes. |
| Testing tool loops with invented `{ name, result }` tool-result messages only | Reproduce the real dispatcher shape: assistant tool call metadata plus later `tool_result.toolCallId` and bare result payload. |
| Truncating a runtime tool result into non-JSON display text | Keep a compact typed JSON envelope and omit only heavy evidence/trace fields. |
| Assuming persisted history exists before live AgentFlow canvas focus | Use live `run_sub_agentflow` runtime activity as a fallback until persisted tool-result history catches up. |
| Adding `forwardRef` to make a module cycle compile | Move the endpoint/type/provider to the module that owns the dependency or to a shared contract. |
| Moving pure runtime schema validation back into `ArchitectureRuntimeService` | Keep it in standalone utilities with direct unit coverage. |
| Moving audit recovery status or typed field decoding back into `ArchitectureRuntimeService` | Keep audit row derivation in `architecture-runtime-audit-recovery.utils.ts` with direct tests plus runtime service regression coverage. |
| Moving CLI preference or VFS evidence payload shaping back into `ArchitectureRuntimeService` | Keep context shaping in `architecture-runtime-context.utils.ts`; the service should only gather dependency data and call the pure helper. |
| Moving finalization/materialization checks back into `ArchitectureGraphRuntime` | Keep graph finalization rules in `architecture-graph-finalization.utils.ts` with direct tests plus runtime integration coverage. |
| Moving graph routing selectors back into `ArchitectureGraphRuntime` | Keep typed routing selectors in `architecture-graph-routing.utils.ts` with direct tests plus runtime integration coverage. |
| Moving child branch stream projection back into `ArchitectureGraphRuntime` | Keep child/HITL/tool event projection in `architecture-graph-branch-events.utils.ts` with direct tests plus runtime integration coverage. |
| Moving graph topology/resume selectors back into `ArchitectureGraphRuntime` | Keep root/edge/readiness/resume selectors in `architecture-graph-topology.utils.ts` with direct tests plus runtime integration coverage. |
| Filtering visit-capped ready nodes without recording them as blocked | Partition ready nodes through the scheduler helper and emit typed `max_node_visits` when all pending work is capped. |
| Re-inlining Goal Master proof gating into `ArchitectureGraphRuntime` | Keep judge continuation rules in `architecture-graph-judge-guard.utils.ts` with direct tests plus runtime integration coverage. |
| Re-inlining recoverable node fallback routing into `ArchitectureGraphRuntime` | Keep recoverable error decisions in `architecture-graph-recoverable-error.utils.ts` and assert typed `failure`, `errorCode`, `route.source`, and `selectedNodeIds`. |
| Re-inlining subagent max-iteration budget selection into `ArchitectureRoleExecutorService` | Keep budget selection in `architecture-role-execution-budget.utils.ts` and assert default `30`, context precedence, saved global setting fallback, and clamp rules. |
| Calling `pnpm` from a package script that root gates invoke | Let the root workspace gate orchestrate package order; package scripts should invoke local build/test binaries directly. |
| Proving one workflow by fetching every session in the QA database | Use scoped session/children endpoints for the active host session and traverse only that workflow tree. |
| Retrying Playwright API assertions after HTTP/runtime failures | Retry only connection-level transport resets; fail fast on real API responses and domain state. |
| Seeding assistant chat history without turn linkage | Seed `turn_id` and `prompt_message_id` so restored timelines do not depend on legacy chronological guessing. |
| Rehydrating only the newest `architectureRun` in a host chat | Dedupe all persisted workflow summaries by `runId` and restore each one as its own workflow-envelope turn. |
| Running Playwright against a rebuilt frontend with stale or empty runtime config | Regenerate `dist/runtime-config.js` from the managed QA stack state before browser checks. |
| Letting E2E/random-port preview overwrite a shared runtime-config consumed by a fixed QA preview | Serve runtime config from each Vite dev/preview process env or another typed per-stack source. |
| Running Playwright/runtime helpers against a different DB than the managed QA API | Propagate the active stack `DATABASE_PATH` to every release-gate subprocess. |
| Reporting `Session ... did not appear` while the UI shows reconnect/connection dropped | Treat reconnect as the primary failure and include transport diagnostics in the E2E helper error. |
| Blocking session selection on a stale recovery notice after the socket is connected | Gate on typed/active connection status and keep the notice as diagnostic output only. |
| Seeding runtime attention failures only as assistant text | Seed typed `tool_result` / runtime snapshot evidence and assert selectors/projections read that typed evidence. |
| Assuming every Talk-started AgentFlow reload renders a `SubAgentFlowResultBlock` | Assert the current durable architecture timeline/graph projection and API snapshot. |
| Treating child preload history limits as the active chat history contract | Select the request for the active session before asserting window size. |
| Testing stop behavior by hoping a workflow is slow enough | Use explicit mock `hold(ms)` or another deterministic running state. |
| Calling a workflow slice green because it passed on a stale manual QA stack | Restart or verify the managed stack, refresh runtime config, and rerun the full release gate. |
| Letting release workflow proof reuse a stale QA stack by default | Start a fresh mock stack unless `--reuse-stack` or live-provider proof is explicit. |
| Classifying empty LLM turns by logger warning text | Emit and assert prompt-safe `runtime_event` rows such as `llm.turn.empty_no_tool_retry` and `llm.turn.empty_no_tool_exhausted`. |
| Testing custom Execution Graph canvas labels through whole-container text | Assert backend graph projection plus stable `graph-node-*` ids, status aria-labels, and inspector actions. |
| Requiring the full workflow prompt text immediately after opening a child branch session | Wait for durable/live transcript readiness and allow typed status fallback before asserting role label and transcript length. |

## Verification Gate

- Run focused tests for the changed runtime selectors/hooks/stores and affected FE/BE modules.
- For package-script changes, run a compatibility regression that prevents nested package-manager calls from root-gated package scripts.
- For workflow E2E changes, avoid global state scans; verify child replay and graph proof through the host session tree.
- For structured-output failure changes, prove malformed router/finalizer output through backend integration and Playwright built-stack checks: failed run, failed source node, cancelled downstream node, and graph API `errorCode`.
- For mock-provider/tool-loop changes, include a regression using the persisted dispatcher shape: assistant `toolCalls[]`, matching `tool_result.toolCallId`, and bare result payload.
- For LLM-history/tool-result sanitization changes, include a RED/GREEN regression proving oversized runtime results remain parseable JSON and preserve the typed control fields needed by the next turn.
- For persisted chat-history fixtures, assert restored timelines through durable turn linkage (`turn_id` + `prompt_message_id`) rather than relying on legacy chronological reconstruction.
- For follow-up architecture workflows, assert reload/F5 keeps multiple workflow-envelope turns in the same host chat instead of collapsing to the latest run.
- For fixed/random-port QA gates, prove the browser receives the current API and WS origins from runtime config or another typed stack contract before treating UI reconnect states as runtime failures.
- For runtime-config or stack-launcher changes, prove two concurrent Vite preview processes can return different `/runtime-config.js` values from their own process env, then rerun the workflow release gate.
- For release gates that query persisted runtime state, assert the gate passes the active managed QA `DATABASE_PATH` to Playwright/helper processes.
- For browser workflow gates, assert the app is not in reconnect/connection-dropped state before selecting sessions or starting runtime actions.
- For reconnect-sensitive E2E helpers, assert the active connection indicator is ready and keep recovery notices in diagnostics only.
- For Execution Graph E2E assertions, use backend `/architecture-runs/:id/graph` projection plus `graph-node-*` test ids/status labels; do not depend on whole-canvas `toContainText` for custom-rendered nodes.
- For Runtime Attention regressions, assert the underlying typed evidence and only then assert display text.
- For Talk-started AgentFlow reload regressions, assert both backend durable snapshot/projection and the visible architecture timeline/Execution Graph.
- For active-session history regressions, capture the request matching the active session id before asserting the configured active history limit.
- For stop/cancellation regressions, make the work deterministically interruptible with mock `hold(ms)` and assert the terminal typed state after stop.
- For `chat:stop` or runtime-stop changes, run `chat.gateway.spec.ts`, `architecture-runtime.service.spec.ts`, focused `workflow-stop-runtime.spec.ts`, and `release:workflow-gate`.
- For LLM empty-turn retry/exhaustion changes, run focused RED/GREEN coverage in `llm-turn-runtime.service.spec.ts` plus adjacent runtime-audit and loop-limit regressions; logs must be classifiable from typed audit rows, not warning text.
- For runtime schema/DTO changes, run direct utility coverage plus `architecture-runtime.service.spec.ts` so contract validation and orchestration integration stay aligned.
- For audit-recovery changes, run `architecture-runtime-audit-recovery.utils.spec.ts` plus `architecture-runtime.service.spec.ts`; durable recovery must stay text-free and typed-field driven.
- For runtime context changes, run `architecture-runtime-context.utils.spec.ts` plus `architecture-runtime.service.spec.ts`; context evidence must stay bounded and structured.
- For graph finalization changes, run `architecture-graph-finalization.utils.spec.ts` plus `architecture-graph-runtime.typed-events.spec.ts`, `architecture-graph-runtime.max-visits.spec.ts`, and `architecture-runtime.service.spec.ts`; finalizer state must stay typed and must not regress to text/id heuristics.
- For graph routing changes, run `architecture-graph-routing.utils.spec.ts` plus `architecture-graph-runtime.typed-events.spec.ts`, `architecture-graph-runtime.max-visits.spec.ts`, and `architecture-runtime.service.spec.ts`; route selection must stay based on typed schema edges and structured router output, not display text.
- For branch stream event changes, run `architecture-graph-branch-events.utils.spec.ts` plus `architecture-graph-runtime.typed-events.spec.ts`, `architecture-graph-runtime.max-visits.spec.ts`, and `architecture-runtime.service.spec.ts`; child/HITL/tool projections must stay typed and not become message-text classifiers.
- For graph topology/resume changes, run `architecture-graph-topology.utils.spec.ts` plus `architecture-graph-runtime.typed-events.spec.ts`, `architecture-graph-runtime.max-visits.spec.ts`, and `architecture-runtime.service.spec.ts`; node readiness and resume routing must stay based on typed schema/event fields, not id prefixes or display text.
- For graph scheduler/max-visit changes, run `architecture-graph-scheduler.utils.spec.ts`, `architecture-graph-runtime.max-visits.spec.ts`, and `architecture-runtime.service.spec.ts`; resuming onto a capped pending node must fail terminally with typed `max_node_visits`.
- For Goal Master judge guard changes, run `architecture-graph-judge-guard.utils.spec.ts`, `architecture-graph-runtime.typed-events.spec.ts`, `architecture-graph-runtime.max-visits.spec.ts`, and `architecture-runtime.service.spec.ts`; proof/QA/continuation decisions must stay typed and loop-safe.
- For recoverable node error fallback changes, run `architecture-graph-recoverable-error.utils.spec.ts`, `architecture-graph-runtime.typed-events.spec.ts`, `architecture-graph-runtime.max-visits.spec.ts`, and `architecture-runtime.service.spec.ts`; recoverable role/router/artifact fallback must stay typed and must not parse message text.
- For architecture role execution budget changes, run `architecture-role-execution-budget.utils.spec.ts` plus `architecture-role-executor.spec.ts`; default max iterations must remain `30` unless typed node/persona/context/global settings override it.
- For release-gate script changes, run `node --test scripts\runtime-scripts.test.mjs` and `release:workflow-gate`; final proof should use a fresh mock QA stack unless the test explicitly covers stack reuse.
- Run affected typecheck and build.
- Run Playwright or built-stack smoke for the relevant user flow.
- For runtime/appflow slices, explicitly verify:
  - reconnect/F5 hydration,
  - stop then follow-up,
  - queue state visibility,
  - child-session visibility in Talk and Execution Graph.
  - Need Attention shows active HITL approvals before dismissible notices.
  - RA-App HITL remains visible after F5/reconnect from the durable pending snapshot and disappears only after approve/deny/native-result settlement.
  - focused child/branch previews hydrate persisted transcript without changing the active parent session.
  - focused AgentFlow Canvas renders both before persisted history catches up and after F5/reconnect.
  - durable graph rebuilds from typed event ids without depending on id-prefix parsing.

## Required Documentation

- Update `docs/todos/YYYY-MM-DD-*.md` when the change alters architecture direction or execution plan.
- Update `docs/sessions/YYYY-MM-DD-*.md` with what changed, evidence, release-readiness, and remaining fallbacks/blockers.

## Companion Skills

- Use `kalio-manual-qa` for FE-first runtime proof.
- Use `serena-kalio-code-navigation` for symbol ownership and runtime boundary tracing.
- Use `ast-grep-kalio-structural-search` for repeated structural state-pattern sweeps.
