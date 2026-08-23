# Devin CLI 3000.5 MCP compatibility — 2026-08-23

## Scope

- Updated the host integration against Devin CLI `3000.5.20`.
- Kept the bridge session-scoped and did not modify the user's global Devin MCP configuration.
- No deploy or production mutation was performed.

## Decisions

- Current Devin CLI reads stdio MCP entries from `.devin/mcp_config.local.json`; stdio entries must contain `command`, `args`, and `env` without a `transport` field.
- The ephemeral host now initializes a valid Git repository so Devin's project-root discovery can find the temporary `.devin` overlay.
- The legacy `--config` argument is no longer passed to ACP because the current CLI uses the dedicated project MCP file for this scope.

## Flow

```mermaid
flowchart LR
    A[Kalio Devin ACP host] --> B[Ephemeral workspace]
    B --> C[git init]
    C --> D[.devin/mcp_config.local.json]
    D --> E[Devin CLI 3000.5.20]
    E --> F[stdio Kalio bridge]
    F --> G[Kalio MCP HTTP bridge]
```

## Verification

- Devin CLI was updated with the official Windows installer and reports `3000.5.20`; `devin acp --help` is available.
- Focused Vitest: 4 files, 13 tests passed.
- API typecheck: `pnpm --filter kalio-api typecheck`, exit code 0.
- API build: `pnpm --filter kalio-api build`, TSC found 0 issues and SWC compiled 631 files.
- `git diff --check`: passed.
- Source backend health: `GET /api/health` returned 200 on the isolated test database.

## Runtime boundary

The real Devin canary reached `agent:done`, but did not produce the success marker. Devin reported the global server `kalio` instead of the intended `kalio-runtime`; its bridge request was unavailable because the local bridge returned HTTP 503 while no bridge token was configured. This is recorded as `BLOCKED`, not a passing integration proof. The canary session was deleted afterward.

## Remaining

- `[P2]` Confirm why ACP session MCP discovery still resolves the global server when the project-local overlay is present, then repeat the canary with the Kalio bridge token enabled.
- `[P2]` Do not call the Devin integration release-ready until the real `vfs_list` result and scoped approval audit are observed on the updated CLI.
