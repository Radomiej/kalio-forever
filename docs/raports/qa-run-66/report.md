# QA run 66 — local MCP override experiment and editor-import boundary

## Evidence

- Actual installed Devin3000.11.1 rejects `mcp disable -s local serena` when Serena exists only in user-wide config. The command returned an explicit scope error; no global config mutation was performed.
- A temporary project-local complete dummy server entry with `disabled:true` successfully overrides same-named global Serena and Context7 entries. `mcp list` shows both rows with disabled markers and no enabled marker. This is configuration/catalog evidence, not process-start isolation proof. Temporary fixture directories cleaned in finally; no ACP or model inference.
- Original catalog-absence experiment remains RED and must not be treated as an execution-isolation regression: disabled entries remain listed. Raw output is not printed; diagnostic metadata is reduced to known names, booleans and masked row punctuation.

## Implemented source change

`createDevinCliConfig` now explicitly disables six documented foreign-client imports in its ephemeral project config: cursor, windsurf, claude, copilot, opencode and zed. The existing scoped bridge, exact requested model, default authentication resolution and global files are unchanged. Standard AGENTS.md import is not disabled.

Regression RED: expected import map was absent. After patch, focused config/shutdown/host suite 13/13 PASS (4.67s), including actual disposable Windows process-tree teardown. API tsc --noEmit PASS; Nest build0 issues, SWC668 files PASS. No public type contract or VFS global read adapter was added.

## Architecture advisory

Read-only advisor Boyle reviewed a self-contained packet and was closed after completion. It recommends one bounded CLI inventory plus a bulk write of local disabled overrides, not per-server subprocesses or global file reads. It also identifies an unavoidable discovery/startup race without a supported complete-replacement boundary, plus separate hooks/native-tool controls. This advice influenced the limited editor-import patch and prevents describing it as strict isolation.

## Remaining / deployment

- [P1] Before claiming strict isolation, establish a complete configuration-loading boundary plus hooks/native-tool proof. A discovered-name suppression patch cannot establish that guarantee.
- [P2] A supported version-specific inventory parser and bulk suppression of inherited native Devin MCP are not yet implemented. Local disabled-row experiment is not live process proof.
- Current QA remains running its previous loaded backend; the source import patch is not yet deployed. Avoid unnecessary repeated host restarts until the next complete verified slice is ready. Existing Home Site preview and user conversation were not reset in this run.
- No target writes, credentials, native permissions, global settings, paid inference, or foreign-agent work changed.

Official basis: [configuration import reference](https://docs.devin.ai/cli/reference/configuration/config-file), [MCP configuration](https://docs.devin.ai/cli/extensibility/mcp/configuration), [precedence](https://docs.devin.ai/cli/reference/configuration/global-vs-local).
