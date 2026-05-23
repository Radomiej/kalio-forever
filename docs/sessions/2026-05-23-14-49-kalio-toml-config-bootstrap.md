# Kalio TOML config bootstrap

## What was done

- Added a new global `KalioConfigModule` and `KalioConfigService` under `apps/kalio-api/src/config`.
- Added layered TOML loading with precedence: `~/.kalio/config.toml` first, then project `.kalio/config.toml` layers from project root to current working directory.
- Added focused unit tests for config loading, precedence, project-root scoping, and parse errors.
- Wired `KalioConfigModule` into `AppModule`.
- Migrated `TimeoutSettingsService` to read TOML-managed timeout values before falling back to `app_settings`.
- Added focused timeout tests proving TOML overrides beat SQLite-backed values.
- Migrated `CLIAgentConfigService` to read `cli_agents.<agentId>` from TOML before filesystem JSON.
- Blocked API writes for TOML-managed CLI agent configs so TOML remains the source of truth.
- Added focused CLI agent config tests for TOML reads, normalization, and write rejection.

## Files touched

- `apps/kalio-api/package.json`
- `apps/kalio-api/src/app.module.ts`
- `apps/kalio-api/src/config/kalio-config.module.ts`
- `apps/kalio-api/src/config/kalio-config.service.ts`
- `apps/kalio-api/src/config/kalio-config.service.spec.ts`
- `apps/kalio-api/src/config/kalio-config.types.ts`
- `apps/kalio-api/src/modules/credentials/timeout-settings.service.ts`
- `apps/kalio-api/src/modules/credentials/timeout-settings.service.spec.ts`
- `apps/kalio-api/src/modules/cli-agent/cli-agent-config.service.ts`
- `apps/kalio-api/src/modules/cli-agent/cli-agent-config.service.spec.ts`

## Decisions made

- TOML support uses `@iarna/toml`.
- Arrays replace lower-precedence arrays; nested tables merge recursively.
- Project config discovery stops at the detected project root (`.git`) so parent directories above the repo do not leak config.
- This slice changes read precedence first; it does not yet add UI metadata for config-managed settings.
- CLI agent configs managed by TOML are explicitly read-only via API to avoid silent JSON/TOML divergence.

## Validation

- `pnpm install --filter ./apps/kalio-api`
- `cd apps/kalio-api && npm run test -- src/config/kalio-config.service.spec.ts`
- `cd apps/kalio-api && npm run test -- src/config/kalio-config.service.spec.ts src/modules/credentials/timeout-settings.service.spec.ts src/modules/cli-agent/cli-agent-config.service.spec.ts`
- VS Code diagnostics on touched files: no errors.

## Open questions

- How should config-managed timeout settings behave on write surfaces: ignore writes, reject them, or accept DB fallback writes with source metadata?
- What exact TOML shape should become canonical for MCP server definitions in Kalio, especially around runtime-only status fields?
- Which API responses should expose `source: 'toml' | 'storage'` metadata so the frontend can render read-only states clearly?

## Next steps

- Add `KalioConfigService` accessors for MCP server definitions and feature flags.
- Split MCP persistent definitions from runtime connection status and merge config-managed servers into the effective registry.
- Add config-source metadata to settings endpoints before flipping frontend panels into read-only/config-managed modes.