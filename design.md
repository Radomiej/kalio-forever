# Kalio Demo UX Direction

## Goal
Ship a demo-ready chat + orchestrator interface for power users: fast to demo, fast to diagnose, and fast to test workflows that touch VFS/tool/image/design features.

## Principles
- Prioritize action density over decoration. Default view should feel like a control surface, not an app shell.
- Preserve context during long runs: every major action must remain visible and replayable from session state.
- Optimize for repeatable testing: cheap, predictable paths first; verbose diagnostics second.
- Keep controls discoverable by icon-first affordances with hover/focus tooltips.
- Make failure states obvious and actionable (origin, step, agent, payload, and recovery).

## Layout Rules (Demo-Ready)
- Use a compact shell: single top bar, fixed command rail, left session explorer, center chat/conversation, right detail/inspector panel.
- Remove wasted chrome:
  - No duplicate headings, status banners, or static helper cards when action is available.
  - One dense message stream; one execution graph view; one inspector panel.
  - Collapse optional metadata behind accordions (errors, raw payload, token stats).
- Chat and orchestrator must feel co-located:
  - New user message triggers immediate session focus.
- Compact icon controls:
  - Main actions use icon buttons (run, stop, retry, copy, zoom, expand, filter, clear).
  - Use minimal labels in primary mode; labels may appear in tooltip or expanded drawer.
- Keyboard-first flow:
  - Enter/Shift+Enter for message send/newline behavior consistent across desktop and touch flows.
  - Single-step undo/retry from current assistant branch.

## Graph Readability Rules
- Execution graph is primary for orchestration trust: keep it visible by default in live sessions.
- Node rules:
  - Fixed minimum width/height; fixed icon size; 1:1 spacing rhythm.
  - Color meaning is binary first (success/warn/error), then type-based accents.
  - Long labels are truncated with ellipsis + tooltip, never wrapping into node bleed.
- Edge rules:
  - Direction is always top-to-bottom with deterministic ordering (by timestamp, then depth).
  - Parent-child edges should be clearly heavier than leaf transitions.
- Readability defaults:
  - Show only last N nodes by default for high-volume tests, with explicit "expand history" action.
  - Keep failed/aborted nodes sticky until acknowledged.
- For demo mode, default zoom should fit entire active tree; allow one-step zoom-in for deep branches.

## Session Tree Rules
- Support multi-level subagent branching (parent/child/reply chains).
- Tree behavior:
  - Root sessions first, children nested with clear indent and connector.
  - One-click jump to any node, including root groups; active node is highlighted and reflected in both chat and graph.
- Power-user flow:
  - Keep previous path and allow branch switching without losing composed prompt draft.
  - Optional "compare branch" mode for two active runs in the same root.
- Tree state indicators:
  - origin, agent name, branch depth, completion status.

## Origin Filters
- Filters are hard requirement: `All`, `User`, `Agent` (and future `External Hook`).
- Default filter behavior:
  - `All` in demos.
  - `User` for hand-off review.
  - `Agent` for orchestration/debug.
- Origin metadata is surfaced on each node and persisted per session.
- External hook outputs should be visually separated from core agent messages and marked as non-editable.

## Model & Testing Baseline
- Set default inference provider/model to **MiMo v2.5 pro** for internal high-volume testing to reduce cost while preserving throughput.
- Keep model in a clearly documented default profile with test-specific override path.
- Record cost/latency per run in session metadata for QA runs.

## Presets & Personas
- Translate high-level Agent Architecture Lab ideas into Kalio-native presets instead of copying raw prompt files.
- Keep default personas small and legible:
  - Orchestrator: routes work, supervises tools, resolves conflicts.
  - Researcher: evidence, sources, assumptions, external checks.
  - Builder: scoped implementation and repair.
  - Designer: UI clarity, accessibility, demo ergonomics.
  - Critic: failure modes, weak evidence, release risk.
- Demo councils:
  - Strategic Decision Council: general architecture/product deliberation.
  - Five Minds Council: parallel pragmatist, innovator, analyst, user advocate, and critic roles converging through a synthesizer and final artifact.
- Any imported preset must define role slots, graph nodes, edges, router policy, context policy, and output artifact expectations.

## Workflow Priorities for VFS/Tool/Image/Design
- Testing scenarios must cover end-to-end loops:
  - create/modify/read files in VFS,
  - call tools and surface results inline,
  - upload/use images as first-class message artifacts,
  - open design docs/resources from within session context.
- Host project writes must use `fs_write` or a CLI agent with allowed paths.
  VFS write tools are only for relative conversation-sandbox paths. If an agent
  sends `C:\...` to `vfs_write`, show a corrective error that suggests `fs_write`
  instead of leaving the user with only `PATH_TRAVERSAL_DENIED`.
- Backend reloads during active tool execution currently surface as
  `BACKEND_RESTART` / `interrupted_needs_retry`; the retry UI must make this
  obvious and preserve enough context for a safe manual retry.
- Validation checkpoints:
  - each tool call shows input/output signatures,
  - media artifacts show source, dimensions, and storage location,
  - design changes can be reproduced from captured session logs.

## MCP Migration Direction
- Move MCP source from Codex AppData into Kalio configuration.
- Use TOML-first structure for MCP declarations, but keep backward compatibility until migration complete.
- Migration checklist:
  - import existing MCP entries into Kalio TOML,
  - enforce explicit environment/secrets separation,
  - validate schema compatibility in bootstrap/startup,
  - provide Settings UI reload so TOML edits apply without API restart,
  - show migration status in diagnostics panel.
- Treat this as phased rollout: read TOML as runtime-managed servers, reconcile existing entries, then switch default source after parity checks.

## Verification Checklist
- Demo interaction
  - Start a sample session and reach assistant response in <2 interactions.
  - Trigger one agent-subagent chain; verify tree render and jump-to-node.
- Graph readability
  - Open a 5+ depth session and verify node labels, spacing, color semantics, and zoom defaults.
- Origin filtering
  - Toggle `All`, `User`, `Agent`; confirm counts and visible items match filter state.
- Power-user path
  - Use at least 3 quick controls (retry/stop/copy/filter) and execute one branch switch without losing draft.
- VFS/tool/image/design
  - Create a test file, invoke a tool, attach image output, and reference design artifact in session.
- Model baseline
  - Confirm default profile resolves to MiMo v2.5 pro and logs include provider/model metadata.
- MCP migration readiness
  - Verify TOML MCP config parser path exists, Settings reload works, and app reports unresolved/legacy sources clearly.
