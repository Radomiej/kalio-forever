# FE Shell Audit Rules

Reusable `ast-grep` rules for Kalio frontend shell/workflow regressions.

Purpose:

- keep `New Chat`, live turn rendering, and workflow shell on one FE model,
- catch reintroduced heuristic branches before they spread,
- provide a stable file-based fallback when inline YAML execution is flaky.

Recommended workflow:

1. Narrow scope with Serena.
2. Run a quick `find_code` pattern sweep through MCP.
3. If you need a reusable rule, use one of the YAML files here.
4. Prefer `ast-grep scan --rule <file> apps/kalio-web/src` over ad-hoc duplication.

Current rule pack:

- `direct-message-streaming-flag.yml`
  - finds direct `message.streaming === true` reads that bypass live-turn helpers.
- `shell-mode-conditional.yml`
  - finds direct `conversationShellState.mode === ...` branching.
- `launch-entrypoints.yml`
  - finds all FE launch entrypoints still calling `createAndActivateHostSession(...)`.

These rules are audit-oriented. A match is not automatically a bug. It is a review hotspot.

