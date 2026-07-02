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
- Manual HITL approvals are durable waits, not timed failures. Tool and RA-App approvals may end only by approve, deny, user/system stop, or explicit workflow cancellation.
- RA-App approvals must be projected into Need Attention from the backend durable pending snapshot; parsing active transcript messages is only a fallback for already loaded sessions.
- Global RA-App approve/deny actions must identify/watch the owning session before emitting socket events, because backend approval handling enforces socket session ownership.
- RA-App inline pending overlays must settle only from typed approval resolution (`raapp:native_result`, approval id, session id) or refreshed durable state, never from display text.
- Runtime lifecycle observability must emit typed `runtime_event` rows with stable `eventName`, status, reason/error code, and IDs. Do not use prompt/message text as the audit contract.
- Durable graph reconstruction must prefer typed event fields such as `architectureEventId` / `eventId` and treat `toolCall.id`, `sessionId`, and message ids as opaque identifiers, not state machines or event classifiers.
- Malformed structured output from architecture router/finalizer paths is a typed `CONTRACT_VIOLATION`, not a routing hint. Persist the failed run, expose node-level `errorCode/failure` in graph projection, and cancel downstream nodes instead of leaving finalizer/children pending.
- Runtime endpoints should live in the module that owns the runtime dependency. Do not create circular module imports for a controller method; split the controller or shared types instead.
- Child session previews must preload or hydrate persisted child history through the shared session history path; do not show a permanent waiting preview when backend history already has messages.
- Launch surfaces should converge on one activation path. Home tiles, composer flows, graph actions, and RA-App entrypoints must create a typed intent and use the same session activation logic.
- Root workspace gates must own package orchestration. Package `build`/`typecheck` scripts should call local tools such as `tsc`, not nested `pnpm`/`npm` commands that can mutate or re-resolve workspace dependencies during a root gate.
- Runtime E2E and release gates should inspect the scoped session tree for the active host (`GET /api/sessions/:id`, `GET /api/sessions/:id/children`) instead of listing global `/api/sessions` and filtering client-side.
- Playwright API retries may cover retryable transport resets while a live workflow is active, but must not retry or hide HTTP 4xx/5xx, typed runtime failures, or failed assertions.
- Persisted chat history used by tests, fixtures, and migrations should include durable `turn_id` and `prompt_message_id` for assistant messages. Chronological turn reconstruction is a legacy fallback, not a test contract.
- A host chat can contain multiple architecture workflow envelopes after follow-up runs. Reload/F5 hydration must collect and project every persisted `architectureRun` by `runId`; never infer host workflow state from only the last `architectureRun` message.
- Built QA/release browser gates that reuse an already running random-port stack must refresh the built frontend `runtime-config.js` from the authoritative stack state before opening the app. Do not rely on static frontend/backend port pairs for Socket.IO or API origin.

## Design Moves

- Prefer moving truth toward `runtimeActivitySnapshots`, selectors, and projector/store helpers.
- Prefer deleting panel-local lifecycle heuristics after the shared runtime path exists.
- Prefer FE-first validation: Talk, Session Panel, Canvas, and Execution Graph should agree on the same runtime state.

## Anti-Patterns

| Mistake | Better move |
|---|---|
| Fixing one panel with a local state map | Extend the shared runtime contract or selector. |
| Trusting stale `session:status` over a newer runtime snapshot | Treat runtime snapshot as authoritative and keep status as fallback only. |
| Adding a new child-run shape for each tool family | Project child work into one `childExecutions` model. |
| Proving runtime only with API polling | Start from Kalio FE and verify UI/runtime parity there. |
| Letting HITL expire while waiting for a human | Keep the request pending and surface it in Need Attention until explicit resolution. |
| Hiding RA-App approvals unless their chat transcript is loaded | Hydrate pending RA-App approvals from the durable backend snapshot and merge transcript-derived approvals as a fallback. |
| Emitting RA-App approve/deny from a global inbox without session ownership | Identify/watch the approval's session before emitting the socket command. |
| Keeping an inline RA-App overlay pending after typed approval execution | Settle the overlay from `raapp:native_result` matching the session and approval id. |
| Logging `error.message` or prompt content as the runtime source of truth | Log typed `runtime_event` names and reason/error codes; keep text display-only. |
| Parsing `toolCall.id`, `sessionId`, or message-id prefixes to infer graph state | Add explicit typed fields and use raw ids only as opaque compatibility fallbacks. |
| Treating malformed structured-output text as a fallback router decision | Fail with typed `CONTRACT_VIOLATION`, project the failed node, and cancel downstream nodes. |
| Adding `forwardRef` to make a module cycle compile | Move the endpoint/type/provider to the module that owns the dependency or to a shared contract. |
| Calling `pnpm` from a package script that root gates invoke | Let the root workspace gate orchestrate package order; package scripts should invoke local build/test binaries directly. |
| Proving one workflow by fetching every session in the QA database | Use scoped session/children endpoints for the active host session and traverse only that workflow tree. |
| Retrying Playwright API assertions after HTTP/runtime failures | Retry only connection-level transport resets; fail fast on real API responses and domain state. |
| Seeding assistant chat history without turn linkage | Seed `turn_id` and `prompt_message_id` so restored timelines do not depend on legacy chronological guessing. |
| Rehydrating only the newest `architectureRun` in a host chat | Dedupe all persisted workflow summaries by `runId` and restore each one as its own workflow-envelope turn. |
| Running Playwright against a rebuilt frontend with stale or empty runtime config | Regenerate `dist/runtime-config.js` from the managed QA stack state before browser checks. |

## Verification Gate

- Run focused tests for the changed runtime selectors/hooks/stores and affected FE/BE modules.
- For package-script changes, run a compatibility regression that prevents nested package-manager calls from root-gated package scripts.
- For workflow E2E changes, avoid global state scans; verify child replay and graph proof through the host session tree.
- For structured-output failure changes, prove malformed router/finalizer output through backend integration and Playwright built-stack checks: failed run, failed source node, cancelled downstream node, and graph API `errorCode`.
- For persisted chat-history fixtures, assert restored timelines through durable turn linkage (`turn_id` + `prompt_message_id`) rather than relying on legacy chronological reconstruction.
- For follow-up architecture workflows, assert reload/F5 keeps multiple workflow-envelope turns in the same host chat instead of collapsing to the latest run.
- For fixed/random-port QA gates, prove the browser receives the current API and WS origins from runtime config or another typed stack contract before treating UI reconnect states as runtime failures.
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
  - durable graph rebuilds from typed event ids without depending on id-prefix parsing.

## Required Documentation

- Update `docs/todos/YYYY-MM-DD-*.md` when the change alters architecture direction or execution plan.
- Update `docs/sessions/YYYY-MM-DD-*.md` with what changed, evidence, release-readiness, and remaining fallbacks/blockers.

## Companion Skills

- Use `kalio-manual-qa` for FE-first runtime proof.
- Use `serena-kalio-code-navigation` for symbol ownership and runtime boundary tracing.
- Use `ast-grep-kalio-structural-search` for repeated structural state-pattern sweeps.
