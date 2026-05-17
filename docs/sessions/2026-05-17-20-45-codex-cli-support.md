# 2026-05-17 20:45 — Codex CLI support

## What Was Done

- Added Codex as a supported CLI agent in the backend CLI agent module.
- Extended `run_cli_agent` validation and tool metadata to accept `agentId: "codex"`.
- Added a dedicated `CodexAdapter` using `codex exec --sandbox workspace-write --ask-for-approval never --color never`.
- Wired Codex labels into the web chat output so live and completed CLI runs show `Codex CLI`.
- Made the CLI path placeholder in Settings adapter-specific, so Codex now shows `e.g. /usr/local/bin/codex`.
- Updated the seeded `Fullstack Dev` persona prompt so it no longer describes `run_cli_agent` as Copilot-only.
- Refreshed focused docs to include Codex in the CLI agent architecture and UI flow.

## Files Touched

- `apps/kalio-api/src/modules/cli-agent/adapters/codex.adapter.ts`
- `apps/kalio-api/src/modules/cli-agent/adapters/codex.adapter.spec.ts`
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
- Left non-Git execution as an explicit `extraArgs` choice instead of a default.
- Reused the existing dynamic CLI Agents settings panel instead of adding a Codex-specific settings surface.

## Verification

- Backend targeted tests passed:
  - `src/modules/cli-agent/adapters/codex.adapter.spec.ts`
  - `src/modules/cli-agent/cli-agent.service.spec.ts`
  - `src/modules/tool/tools/run-cli-agent.tool.spec.ts`
  - `src/modules/persona/persona.service.spec.ts`
- Frontend targeted tests passed:
  - `src/features/settings/CLIAgentPanel.test.tsx`
  - `src/features/chat/TerminalOutputBlock.test.tsx`
- Backend typecheck passed: `apps/kalio-api node_modules\\.bin\\tsc.CMD --noEmit`
- Frontend typecheck passed: `apps/kalio-web npm run typecheck`

## Open Questions

- None.

## Next Steps

- If Codex is installed locally, perform one manual app smoke test: Settings -> CLI Agents shows Codex and a `run_cli_agent` call with `agentId: "codex"` renders `Codex CLI` in chat.