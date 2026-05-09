# Session: Documentation Architecture Refresh

**Date**: 2026-05-09  
**Topic**: Refresh of current architecture documentation in `docs/`

## What was done

- Added `docs/application-architecture-current.md` as a new top-level current-state architecture map.
- Rewrote `docs/chat-streaming-tools-architecture.md` around the actual chat hot path: gateway, per-session queueing, FE state split, and child-session fan-out.
- Rewrote `docs/tool-architecture.md` around the actual registry and dispatch path, including confirmation policy, `_emit`, persistence, and sub-agent auto-approve behavior.
- Rewrote `docs/mcp-architecture.md` around the current runtime: background connect, dynamic tool discovery, prefixed names, persona filtering, and restart behavior.
- Rewrote `docs/raapp-design-current.md` to separate inline RA-App results, stored catalog apps, versioned groups, iframe bridge behavior, and native approvals.
- Added a large set of Mermaid flow and sequence diagrams to each updated document.

## Files touched

- `docs/application-architecture-current.md`
- `docs/chat-streaming-tools-architecture.md`
- `docs/tool-architecture.md`
- `docs/mcp-architecture.md`
- `docs/raapp-design-current.md`

## Key decisions

- Document `ChatSession` as the real unit of isolation across socket ownership, queueing, aborts, VFS, KV, and sub-agent lineage.
- Separate durable history models (`ChatMessage`, `tool_result`) from live FE-only models (`ToolActivity`, `AgentTurn`, CLI output buffers).
- Describe sub-agents as ordinary child sessions that reuse the same chat event contract, rather than a second protocol.
- Document MCP allow-list behavior as `persona.allowedTools` plus `mcpPolicy`, not as skill-driven filtering.
- Split RA-App documentation into three distinct concepts: inline block, stored catalog entry, and pending native approval.

## Validation

- Validated every newly added or rewritten Mermaid block with the Mermaid Diagram Validator.
- Opened Mermaid preview for each updated architecture markdown file:
  - `docs/application-architecture-current.md`
  - `docs/chat-streaming-tools-architecture.md`
  - `docs/tool-architecture.md`
  - `docs/mcp-architecture.md`
  - `docs/raapp-design-current.md`
- Checked `git diff --stat -- docs` and `git status --short docs` to confirm the touched documentation set.

## Open questions

- `docs/cli-agent-module-architecture.md` was left unchanged because it still appears aligned with the current adapter-based runtime.
- There is at least one stale MCP naming comment in `packages/@kalio/types/src/index.ts` (`{serverId}::{toolName}` vs runtime `mcp_<serverId>_<originalName>`), but this refresh stayed docs-only.

## Next steps

1. Optionally add a small `docs/README.md` or index page that links `application-architecture-current.md` first.
2. Optionally align stale inline comments in shared runtime types with the naming and filtering behavior now documented here.