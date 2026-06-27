# MCP Settings Dual-Store Rewire

## Acceptance Criteria

- [x] Settings MCP UI consumes shared metadata fields when present: `serverKey`, `store`, `originSource`, `effectiveState`, `conflictGroup`.
- [x] TOML and SQLite variants of the same logical server render as separate rows instead of being collapsed by `id`.
- [x] Restart and remove actions target the backend using `serverKey`, not the raw row `id`.
- [x] MCP row test ids use `serverKey` plus store-aware suffixes so equivalent rows remain individually addressable.
- [x] External import modal treats equivalent entries as selectable informational items, not blocked duplicates.
- [x] Focused frontend tests cover the touched MCP settings slice and pass.

## Current Architecture

```mermaid
graph TD
    Api["/api/mcp/servers"] --> Panel["MCPSettingsPanel"]
    Panel --> Dedup["dedupe by raw id"]
    Dedup --> Row["MCPServerRow"]
    Row --> Actions["restart/remove by id"]
    Row --> Hack["managedBy === 'toml' readonly hack"]
    Panel --> Modal["MCPExternalImportModal"]
    Modal --> Duplicate["duplicate=true blocks selection"]
```

## Target Architecture

```mermaid
graph TD
    Api["/api/mcp/servers"] --> Normalize["normalize metadata-aware settings rows"]
    Normalize --> Panel["MCPSettingsPanel"]
    Panel --> RowToml["MCPServerRow (store=toml)"]
    Panel --> RowSqlite["MCPServerRow (store=sqlite)"]
    RowToml --> Actions["restart/remove by serverKey endpoint"]
    RowSqlite --> Actions
    RowToml --> State["effectiveState + originSource badges"]
    RowSqlite --> State
    Panel --> Modal["MCPExternalImportModal"]
    Modal --> Equivalence["equivalent entries selectable with informational warning"]
```

## Models And Relations

```mermaid
classDiagram
    class SettingsMCPServer {
      +id: string
      +serverKey: string
      +store: "toml" | "sqlite" | string
      +originSource: string
      +effectiveState: string
      +conflictGroup: string?
      +status: string
    }

    class MCPServerRowView {
      +rowKey: string
      +serverKey: string
      +store: string
      +testIdSuffix: string
      +readonly: boolean
    }

    class ExternalMCPServerEntry {
      +id: string
      +key: string
      +equivalentToExisting: boolean
      +conflictGroup: string?
    }

    SettingsMCPServer --> MCPServerRowView : normalized into
    ExternalMCPServerEntry --> SettingsMCPServer : may match by serverKey/conflictGroup
```

## Notes

- Scope started in `apps/kalio-web/src/features/settings/**`, then widened slightly to shared MCP contracts and the panel/runtime call sites required by `serverKey`.
- Shared `@kalio/types` now exposes the dual-store MCP metadata directly; the settings slice remains legacy-tolerant while older responses age out.
- 2026-06-27: focused frontend Vitest passed for `MCPSettingsPanel` and `MCPPanel`.
