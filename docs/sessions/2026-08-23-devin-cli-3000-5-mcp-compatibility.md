# Devin CLI 3000.5 MCP compatibility — 2026-08-23

## Scope

- Updated the host integration against Devin CLI `3000.5.20`.
- Kept the bridge session-scoped and did not modify the user's global Devin MCP configuration.
- No deploy or production mutation was performed.

## Decisions

- Current Devin CLI reads stdio MCP entries from `.devin/mcp_config.local.json`; stdio entries must contain `command`, `args`, and `env` without a `transport` field.
- The ephemeral host now initializes a valid Git repository so Devin's project-root discovery can find the temporary `.devin` overlay.
- The legacy `--config` argument is no longer passed to ACP because the current CLI uses the dedicated project MCP file for this scope.
- ACP sessions use the temporary config workspace as `cwd` and expose the requested project through `additionalDirectories` when the CLI advertises that capability. This lets Devin discover the session-scoped `.devin` config without changing the user's project or global Devin config.
- Devin 3000.5 permission requests may identify an MCP tool by its real name (`vfs_list`) and carry the MCP server only in the title (`Calling vfs_list from kalio-runtime`). Kalio now treats that shape as a scoped MCP approval, not as a native filesystem/terminal request.

## Flow

```mermaid
flowchart LR
    A[Kalio Devin ACP host] --> B[Ephemeral workspace]
    B --> C[git init]
    C --> D[.devin/mcp_config.local.json]
    D --> E[Devin CLI 3000.5.20]
    E --> F[stdio Kalio bridge]
    F --> G[Kalio MCP HTTP bridge]
    G --> H[scoped vfs_list]
```

## Verification

- Devin CLI was updated with the official Windows installer and reports `3000.5.20`; `devin acp --help` is available.
- Focused Vitest: 4 files, 13 tests passed, including the current direct-name ACP permission shape and wrong-server negative case.
- API typecheck: `pnpm --filter kalio-api typecheck`, exit code 0.
- API build: `pnpm --filter kalio-api build`, TSC found 0 issues and SWC compiled 631 files.
- `git diff --check`: passed.
- Source backend health: `GET /api/health` returned 200 on the isolated test database.
- Current dev reproduction: `POST http://127.0.0.1:3016/api/mcp/bridge` returned HTTP 503 with `Kalio MCP bridge is disabled...` while `/api/runtime/devin-cli/settings` reported `configuredBy: none`.
- Token-enabled bridge: the same initialize request on the isolated rebuilt backend returned HTTP 200 and an MCP session id.
- Real Devin canary on isolated port 3026: model `glm-5-2`, `agent:done`, marker `KALIO_DEVIN_MCP_CANARY_OK`, actual `vfs_list {}` result `{files: []}`.
- Audit proof: `devin-cli-acp.mcp_bridge` completed with 62 scoped tools and all native categories disabled; `devin-cli-acp.mcp_approval` completed with `decision: accept`, `server: kalio-runtime`, `toolName: vfs_list`; no `native_approval` was emitted.

## Runtime boundary

The original 503 was a deliberate fail-closed bridge response caused by the absence of a configured token, not a Devin transport failure. After enabling a one-time isolated token, scoping ACP discovery to the config workspace, and accepting Devin 3000.5's direct-name MCP permission shape, the real canary completed successfully through `kalio-runtime`.

## Remaining

- `[P3]` A forced client interruption after the successful canary left the follow-up DELETE returning HTTP 500 because the runtime had already reaped the session (`Session not found`). This is a cleanup-race hardening item, not a bridge or tool-execution blocker.
