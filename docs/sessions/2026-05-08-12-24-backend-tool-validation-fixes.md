# Backend Tool Validation Fixes

## What was done

- Started implementation repair using fail-first methodology, reusing the already-added failing regression specs.
- Fixed runtime validation at the tool boundary for four backend tool slices:
  - `fs_*`
  - `kv_*`
  - `terminal_*`
  - `memory_*`
- Kept fixes narrow: input validation and boundary guards only, without broad refactors or behavior expansion.

## Files touched

- `apps/kalio-api/src/modules/tool/tools/fs-read.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/fs-list.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/fs-write.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/kv.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/terminal.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/memory.tools.ts`

## Decisions

- Validation was added at the tool layer first, not deeper in services, because the failing specs were explicitly about malformed tool-call payloads crossing the tool boundary.
- Error strings were kept aligned with the new regression expectations:
  - `INVALID_PATH`
  - `INVALID_CONTENT`
  - `INVALID_RECURSIVE`
  - `INVALID_KEY`
  - `INVALID_VALUE`
  - `INVALID_COMMAND`
  - `INVALID_ARGS`
  - `INVALID_CWD`
  - `INVALID_ID`
  - `INVALID_TEXT`
  - `INVALID_METADATA`
  - `INVALID_QUERY`
  - `INVALID_LIMIT`
  - `INVALID_MESSAGES`
  - `INVALID_MESSAGE`
- `terminal_spawn` still preserves the dedicated `MISSING_CWD` path for omitted `cwd`.

## Validation

- Focused reruns after each repair slice:
  - `pnpm exec vitest run src/modules/tool/tools/fs-tools.spec.ts`
  - `pnpm exec vitest run src/modules/tool/tools/kv.tools.spec.ts`
  - `pnpm exec vitest run src/modules/tool/tools/terminal.tools.spec.ts`
  - `pnpm exec vitest run src/modules/tool/tools/memory.tools.spec.ts`
- Final combined pass:
  - `pnpm exec vitest run src/modules/tool/tools/fs-tools.spec.ts src/modules/tool/tools/kv.tools.spec.ts src/modules/tool/tools/terminal.tools.spec.ts src/modules/tool/tools/memory.tools.spec.ts`
- Combined result: 4 files passed, 160 tests passed.
- Editor diagnostics on all modified files: no errors.

## Open questions

- Whether some of these validation helpers should be centralized for tool implementations instead of remaining local per file.
- Whether similar runtime validation should next be applied to frontend settings surfaces or to the remaining backend search tools.

## Next steps

- Best next repair batch: frontend settings normalization (`ModelSettingsSection`, `CLIAgentPanel`, `MCPAddServerForm`, `parseMcpJson`) using the already failing tests.