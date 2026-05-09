# 2026-05-01 — run_cli_agent tool complete + persona/sessions fixes

## What was done

Completed implementation of the `run_cli_agent` tool (GitHub Copilot CLI sub-agent).

### Backend
- **`packages/@kalio/types/src/index.ts`**: Added `CLIAgentResult` interface (`output`, `exitCode`, `durationMs`)
- **`apps/kalio-api/src/modules/tool/terminal.service.ts`**: Added `closeStdin` param to `spawn()`, added `waitForExit()` method
- **`apps/kalio-api/src/modules/tool/tools/run-cli-agent.tool.ts`** (NEW): Sync tool wrapping `copilot -p` via `execFileAsync`; validates workdir via `AllowedPathsService`; timeout capped at 20min; returns `CLIAgentResult` on success/failure; throws only on timeout or access denied
- **`apps/kalio-api/src/modules/tool/tool.module.ts`**: Registered `RunCliAgentTool`
- **`apps/kalio-api/src/modules/tool/tools/run-cli-agent.tool.spec.ts`** (NEW): 6 tests — all pass

### Frontend
- **`apps/kalio-web/src/features/chat/TerminalOutputBlock.tsx`** (NEW): Expandable terminal-style output component; shows exit code, duration, collapsible raw output
- **`apps/kalio-web/src/features/chat/ToolCallBubble.tsx`**: Added `CLIAgentResult` + `TerminalOutputBlock` import; added `extractCLIAgentResult()` helper; updated `HistoryToolCallBubble` to render `TerminalOutputBlock` for `run_cli_agent` results

### Bug fixes (pre-existing regressions from previous session)
- **`apps/kalio-api/src/modules/persona/persona.service.ts`**: Fixed wrong path in `loadPersonasConfig()` (`'../assets/personas.json'` → `'../../assets/personas.json'`); fixed BUG-5 (removed `systemPrompt` from `update().set()` so user customizations survive restarts)
- These fixes unblocked 7 previously failing persona tests

## Test result
- **81 test files, 926 tests — all pass**
- Backend typecheck: clean
- Frontend typecheck: clean

## Files touched
- `packages/@kalio/types/src/index.ts`
- `apps/kalio-api/src/modules/tool/terminal.service.ts`
- `apps/kalio-api/src/modules/tool/tools/run-cli-agent.tool.ts` (new)
- `apps/kalio-api/src/modules/tool/tools/run-cli-agent.tool.spec.ts` (new)
- `apps/kalio-api/src/modules/tool/tool.module.ts`
- `apps/kalio-api/src/modules/persona/persona.service.ts`
- `apps/kalio-web/src/features/chat/TerminalOutputBlock.tsx` (new)
- `apps/kalio-web/src/features/chat/ToolCallBubble.tsx`

## Open questions / next steps
- Manual E2E test: verify `run_cli_agent` works end-to-end with real `copilot -p` binary
- Sub-agent integration test: verify sub-agents can see `run_cli_agent` in tool list and invoke it
- `TerminalOutputBlock` uses `open` state initialized to `true` when cliResult is present — consider whether collapsed-by-default is better UX for long outputs
