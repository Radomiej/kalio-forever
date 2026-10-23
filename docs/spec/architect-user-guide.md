# Architect User Guide

Architect is Kalio's graph editor and runtime viewer for schema-driven agent workflows. Use it to design how agents route work, save reusable variants, run the workflow, and inspect what happened.

## Core Modes

| Mode | Purpose | What persists |
| --- | --- | --- |
| Editor | Build and tune the architecture graph. | Changes persist only after `Save variant`. |
| Runtime preview | Observe an active run: current nodes, visit counts, route hops, tool activity, timeline, and chat projection. | Runtime overlay resets after the run; saved variants remain unchanged. |

Runtime preview is intentionally read-only for graph editing. You can select nodes and inspect them while the scene runs, but moving, adding, connecting, and auto-layout edits are ignored until you return to Editor mode.

## Creating A Graph

1. Pick a preset from the left registry.
2. Use the toolbar:
   - Pointer: select and move nodes.
   - Connect: click source node, then target node to add or remove an edge.
   - Agent: add a role/worker node.
   - Router: add a decision node.
   - Parallel: add a fan-out node.
   - Artifact: add a final output node.
   - Layout: auto-layout the graph into readable columns.
3. Select a node to edit persona, node kind, behavior, routing strategy, fan-out, and convergence settings in the inspector.
4. Save durable edits with `Save variant`.

The canvas has extra free space around the graph. Pan the viewport to stage larger workflows even when the current graph fits on screen.

## Node Types

| Node | Use for | Typical outgoing behavior |
| --- | --- | --- |
| Agent / Role | One worker persona performing bounded work. | Forced transition to the next node. |
| Router | Decision, guard, reviewer, or master agent routing to one or more next nodes. | Conditional routing. |
| Parallel | Fan-out to multiple agents or branches. | Parallel branch execution. |
| Artifact | Final synthesis or deliverable. | Usually terminal. |

## Connection Types

Architect styles edges by source node behavior:

| Visual style | Meaning |
| --- | --- |
| Solid sky edge | Forced transition from one node to the next. |
| Dashed amber edge | Router/master-agent decision path. Runtime may choose this path conditionally. |
| Dotted violet edge | Parallel fan-out path. Multiple branches can run together. |
| Pulsing emerald edge | Runtime-executed transition for the current run. |

Router/master edges should represent a real decision point, not a hardcoded next step. Parallel edges should fan out from a centered parallel node and converge back into a centered merge/router/artifact node.

## Auto-layout Rules

Auto-layout arranges the graph in ranked columns:

- entry/source nodes on the left,
- downstream nodes move right by graph depth,
- parallel branches stack vertically with equal spacing,
- source and merge nodes are centered on the middle branch,
- fan-in/fan-out paths keep clear space to avoid overlaps.

Use auto-layout after adding branches, importing a preset, or when a large graph such as Deep Five Minds becomes hard to read. Then use manual movement for final polish and save the result as a variant.

## Running And Inspecting

During a run:

1. Architect switches to Runtime preview.
2. Active/running nodes are highlighted.
3. Each node shows how many times it was invoked in this run.
4. Executed route edges pulse in emerald.
5. Timeline, Execution Graph, and Chat tabs show different projections of the same run truth.

If a run needs a human quality gate, resume it from the Runtime panel with structured QA evidence instead of editing the target project manually.

## Saving Variants

`Save variant` persists:

- node positions,
- added nodes,
- graph edges,
- node behavior changes,
- node kind changes,
- persona overrides,
- context policy overrides.

Runtime-only visualization does not persist. To keep a layout or behavior change, make it in Editor mode and save a variant.
