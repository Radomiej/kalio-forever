# Kalio Tech Debt

This file tracks audit items that are real but should not block the current MVP recovery work.

## Fixed in the current chat recovery slice

| Item | Status | Notes |
|---|---|---|
| Reconnect history overwrite | Done | Reconnect reload now merges fetched history with local optimistic messages before rebuilding turns. |
| Runtime chat status replay | Done | `session:identify` now replays active turn/queue status so the frontend can restore a live turn after reconnect. |
| Keep existing chat FSM | Done | The current `SessionPipelineService` remains the source of truth for per-session queue/interrupt/stop behavior. |

## Post-MVP

| Item | Why it matters | Suggested next step |
|---|---|---|
| Durable turn/run journal | Needed for safe auto-resume after backend crash or process restart. In-memory FSM state cannot survive a restart. | Add a persisted `chat_runs`/`turn_runs` table with status, turnId, sessionId, last checkpoint, startedAt, updatedAt, and terminal error. |
| Backend restart auto-resume | A restart currently can recover history, but not continue an interrupted LLM/tool loop safely. | Define idempotent resume rules: resume only pending LLM calls without started tools; mark uncertain tool phases as interrupted and ask user to retry. |
| Full state-machine library | XState may help once states are durable and explicit, but adding it now would wrap an already-tested custom FSM. | Re-evaluate after durable run journal exists. |
| Message virtualization | Long conversations can grow the DOM and slow the chat view. | Add `react-virtuoso` or equivalent after recovery semantics are stable. |
| TanStack Query migration | Would improve cache/retry/loading states for REST data, but does not solve chat recovery by itself. | Migrate one feature at a time, starting with sessions/personas, not the live stream path. |
| Auth/RBAC | Needed before multi-user or exposed deployments. | Keep local-first assumptions for MVP; design auth as a separate security milestone. |
| Credential encryption | API keys are intentionally not returned by APIs, but DB-at-rest encryption is still missing. | Implement libsodium secretbox or OS keychain-backed encryption with migration support. |
| Tool sandboxing | Host CLI tools can be destructive if misconfigured. | Add optional Docker/Podman execution backend for high-risk tools. |
| OpenTelemetry traces | Useful for diagnosing long tool loops and agent runs. | Add after run IDs are durable so traces can link to persisted chat runs. |
| Socket.IO Redis adapter | Required for horizontal scaling. | Defer until more than one backend process is a real deployment target. |

