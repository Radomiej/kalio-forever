# 2026-05-18 12:54 - Gemini ripgrep and ConPTY diagnosis

## What was done

- Investigated why Gemini CLI reported `Ripgrep is not available. Falling back to GrepTool.` during `run_cli_agent`.
- Investigated why Gemini CLI sometimes prints `AttachConsole failed` on Windows.
- Compared direct shell behavior with Kalio's headless spawn behavior.
- Checked the reference repo `C:\Projekty\mcp-cli-agents` for any special handling around Gemini, ripgrep, or ConPTY.

## Findings

- `rg` is not currently resolvable in the actual shell environment used for validation:
  - `Get-Command rg` returned nothing
  - `where.exe rg` failed
  - `C:\Users\Radomiej\.cargo\bin` is present in `PATH`, but `C:\Users\Radomiej\.cargo\bin\rg.exe` does not exist
  - common VS Code / Git ripgrep locations also did not contain `rg.exe`
- The ripgrep warning is therefore real, not caused by an old Kalio session.
- The same ripgrep warning appears in direct Gemini CLI runs in both `C:\Projekty\mcp-web-search` and the reference repo `C:\Projekty\mcp-cli-agents`.
- `AttachConsole failed` was reproduced outside Kalio by spawning Gemini from Node with piped stdio, matching `CLIAgentService` behavior. This isolates the warning to Gemini CLI's Windows `node-pty` / ConPTY behavior in headless execution, not to repo state or stale chat sessions.
- The warning is non-fatal in the reproduced case: Gemini still exited with code 0 and returned the requested `npm --version` output.

## Files / surfaces inspected

- `apps/kalio-api/src/modules/cli-agent/cli-agent.service.ts`
- `apps/kalio-api/src/modules/cli-agent/adapters/gemini.adapter.ts`
- Reference repo `C:\Projekty\mcp-cli-agents` source/config search (no special ripgrep or ConPTY workaround found)

## Validation

- Direct shell checks for `rg`
- Direct Gemini CLI runs in `C:\Projekty\mcp-web-search` and `C:\Projekty\mcp-cli-agents`
- Node-based headless spawn reproduction matching Kalio's `stdio: ['pipe','pipe','pipe']`

## Next steps

- Install a real `rg.exe` visible to the execution environment or add its real location to `PATH`; the warning will remain until that exists.
- If the ConPTY stack trace is too noisy in UX, consider filtering that specific known non-fatal Gemini stderr block when exit code is 0, or investigate whether Gemini CLI exposes an env/flag to disable the failing helper.