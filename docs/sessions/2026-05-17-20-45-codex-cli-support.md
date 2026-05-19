# 2026-05-17 20:45 — Codex CLI support

## What Was Done

- Added Codex as a supported CLI agent in the backend CLI agent module.
- Extended `run_cli_agent` validation and tool metadata to accept `agentId: "codex"`.
- Added a dedicated `CodexAdapter`, then corrected it after live smoke to use `codex -a never exec --sandbox workspace-write --color never` so it matches Codex CLI 0.130.0.
- Updated `GeminiAdapter` to use `--include-directories` instead of the now-rejected `--add-dir` flag.
- Wired Codex labels into the web chat output so live and completed CLI runs show `Codex CLI`.
- Made the CLI path placeholder in Settings adapter-specific, so Codex now shows `e.g. /usr/local/bin/codex`.
- Updated the seeded `Fullstack Dev` persona prompt so it no longer describes `run_cli_agent` as Copilot-only.
- Refreshed focused docs to include Codex in the CLI agent architecture and UI flow.
- Ran real shell and Playwright smoke against `ProjectPlanner`, including confirmed `run_cli_agent` runs from the `Orchestrator` persona.

## Files Touched

- `apps/kalio-api/src/modules/cli-agent/adapters/codex.adapter.ts`
- `apps/kalio-api/src/modules/cli-agent/adapters/codex.adapter.spec.ts`
- `apps/kalio-api/src/modules/cli-agent/adapters/gemini.adapter.ts`
- `apps/kalio-api/src/modules/cli-agent/adapters/gemini.adapter.spec.ts`
- `apps/kalio-api/src/modules/cli-agent/cli-agent.module.ts`
- `apps/kalio-api/src/modules/cli-agent/cli-agent.service.ts`
- `apps/kalio-api/src/modules/cli-agent/cli-agent.service.spec.ts`
- `apps/kalio-api/src/modules/chat/llm-service.adapter.ts`
- `apps/kalio-api/src/modules/tool/tools/run-cli-agent.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/run-cli-agent.tool.spec.ts`
- `apps/kalio-api/src/modules/persona/persona.service.spec.ts`
- `apps/kalio-api/src/assets/personas.json`
- `apps/kalio-web/src/features/chat/cli-agent-labels.ts`
- `apps/kalio-web/src/features/chat/TerminalOutputBlock.tsx`
- `apps/kalio-web/src/features/chat/TerminalOutputBlock.test.tsx`
- `apps/kalio-web/src/features/settings/CLIAgentPanel.tsx`
- `apps/kalio-web/src/features/settings/CLIAgentPanel.test.tsx`
- `docs/cli-agent-module-architecture.md`
- `docs/UI-Flow.md`

## Decisions

- Kept Codex as a CLI agent integration, not a new LLM provider type.
- Defaulted Codex to workspace-scoped writes only; did not hardcode `--skip-git-repo-check`.
- Kept Codex on the saved user profile/config path; no Kalio-side custom profile was introduced.
- Left non-Git execution as an explicit `extraArgs` choice instead of a default.
- Reused the existing dynamic CLI Agents settings panel instead of adding a Codex-specific settings surface.
- Treated the `run_cli_agent` confirmation step in Orchestrator as expected central HITL, not as a CLI execution failure.

## Verification

- Backend targeted tests passed:
  - `src/modules/cli-agent/adapters/codex.adapter.spec.ts`
  - `src/modules/cli-agent/adapters/gemini.adapter.spec.ts`
  - `src/modules/cli-agent/cli-agent.service.spec.ts`
  - `src/modules/tool/tools/run-cli-agent.tool.spec.ts`
  - `src/modules/persona/persona.service.spec.ts`
- Frontend targeted tests passed:
  - `src/features/settings/CLIAgentPanel.test.tsx`
  - `src/features/chat/TerminalOutputBlock.test.tsx`
- Backend typecheck passed: `apps/kalio-api node_modules\\.bin\\tsc.CMD --noEmit`
- Frontend typecheck passed: `apps/kalio-web npm run typecheck`
- Adapter regression tests passed after the runtime fix:
  - `apps/kalio-api npm run test -- src/modules/cli-agent/adapters/codex.adapter.spec.ts src/modules/cli-agent/adapters/gemini.adapter.spec.ts`
- Live shell smoke on `C:\Projekty\ProjectPlanner`:
  - `copilot` succeeded in read-only describe mode
  - `gemini` succeeded with the corrected `--include-directories` invocation
  - `codex` started on the user profile path but failed on an OpenAI usage-limit error
  - `claude` failed with `Not logged in · Please run /login`
- Live Playwright smoke on `http://localhost:5188` / `http://localhost:3016`:
  - Settings -> CLI Agents showed Codex, Gemini, and Claude as installed with versions
  - Orchestrator reached `run_cli_agent` for all tested agents, but each call required explicit `Confirm` because of central HITL
  - After confirmation, `copilot` and `gemini` completed successfully through Orchestrator
  - After confirmation, `codex` rendered a terminal result block with header text `Codex CLI` and failed only on usage limit
  - After confirmation, `claude` completed with the expected login error surfaced back into chat

## Open Questions

- None inside Kalio. Remaining blockers are external account state: Codex quota and Claude login.

## Next Steps

- Restore Codex account quota, then rerun the confirmed Orchestrator smoke for `agentId: "codex"` to verify a successful end-to-end project summary.
- Log Claude Code in locally, then rerun the confirmed Orchestrator smoke for `agentId: "claude"`.