# Serena Kalio Code Navigation Skill

Installed skill path:

```text
C:\Users\Radomiej\.codex\skills\serena-kalio-code-navigation\SKILL.md
```

This repository copy records the expected behavior for agents that only read repo docs.

## Core Rule

Use Serena first when the task is about symbol ownership, references, declarations, or durable project context. Do not start by reading whole source files when Serena can narrow the search.

## When To Use

- You need declaration, implementation, or reference lookup for a concrete symbol.
- You need a compact overview of a file before reading symbol bodies.
- You need project memory or repo-specific conventions already captured in Serena memories.
- You want to minimize token-heavy file reads in `kalio-forever`.

## Working Pattern

1. Start with Serena memories when the task smells like project conventions or prior runtime decisions:
   - `core`
   - `frontend/core`
   - `frontend/live_chat_shell`
   - `backend/core`
   - `architecture/runtime`
   - `agentflow/core`
   - `mcp/core`
   - `testing/windows_qa`
2. For code navigation, prefer:
   - `get_symbols_overview` before reading a file deeply
   - `find_declaration` when you already have a usage site
   - `find_referencing_symbols` when you need callers/consumers
3. Read symbol bodies only after narrowing the target.
4. Switch to `ast-grep-mcp` when the question is about syntax shape rather than a named symbol.

## Kalio-Specific Guidance

- Serena is the right first tool for `ChatSession`, `runtimeContext`, FE shell selectors, Execution Graph runtime symbols, and service/module boundaries.
- In this repo, backend owns runtime truth and frontend renders projections. If the task touches ownership or boundaries, check Serena memories before editing.
- Use Serena to follow `resolveConversationShellState(...)`, `resolveLiveTurnState(...)`, session hydration, and child-session lineage through the symbol graph.
- Use Serena memories to avoid rediscovering Windows QA rules, MCP policy assumptions, and AgentFlow constraints already captured after recent setup work.

## Common Mistakes

| Mistake | Better move |
|---|---|
| Reading entire FE/BE files immediately | Ask Serena for symbols first, then read only the needed bodies. |
| Using Serena for broad syntax-shape sweeps | Hand off to `ast-grep-mcp` for AST pattern search. |
| Ignoring Serena memories | Read the relevant memory before re-deriving repo conventions. |
| Treating live UI symptoms as backend-only | Use Serena to walk FE symbol graph and session ownership first. |

## Quick Reference

- Named symbol, declaration, reference, implementation -> Serena
- Project conventions, completion gate, Windows QA rules -> Serena memories
- Narrow source map before manual reading -> Serena
- Structural pattern over many files -> `ast-grep-mcp`
