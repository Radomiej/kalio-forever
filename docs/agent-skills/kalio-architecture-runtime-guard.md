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
- Launch surfaces should converge on one activation path. Home tiles, composer flows, graph actions, and RA-App entrypoints must create a typed intent and use the same session activation logic.

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

## Verification Gate

- Run focused tests for the changed runtime selectors/hooks/stores and affected FE/BE modules.
- Run affected typecheck and build.
- Run Playwright or built-stack smoke for the relevant user flow.
- For runtime/appflow slices, explicitly verify:
  - reconnect/F5 hydration,
  - stop then follow-up,
  - queue state visibility,
  - child-session visibility in Talk and Execution Graph.

## Required Documentation

- Update `docs/todos/YYYY-MM-DD-*.md` when the change alters architecture direction or execution plan.
- Update `docs/sessions/YYYY-MM-DD-*.md` with what changed, evidence, release-readiness, and remaining fallbacks/blockers.

## Companion Skills

- Use `kalio-manual-qa` for FE-first runtime proof.
- Use `serena-kalio-code-navigation` for symbol ownership and runtime boundary tracing.
- Use `ast-grep-kalio-structural-search` for repeated structural state-pattern sweeps.
