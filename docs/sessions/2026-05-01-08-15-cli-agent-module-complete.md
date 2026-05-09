# 2026-05-01 — CLI Agent Module: Complete Implementation

## What Was Done

Implemented a full generic CLI Agent Module for kalio-forever. The old `run_cli_agent` tool was tightly coupled to Copilot CLI with direct `execFile` calls and no streaming. This session completes the full implementation that was started in the previous session.

## Files Created

- `apps/kalio-api/src/modules/cli-agent/adapters/cli-agent.adapter.ts` — `ICLIAgentAdapter` interface
- `apps/kalio-api/src/modules/cli-agent/adapters/copilot.adapter.ts` — GitHub Copilot CLI
- `apps/kalio-api/src/modules/cli-agent/adapters/gemini.adapter.ts` — Google Gemini CLI
- `apps/kalio-api/src/modules/cli-agent/adapters/claude-code.adapter.ts` — Anthropic Claude Code
- `apps/kalio-api/src/modules/cli-agent/output-compressor.ts` — tail-keeps to maxChars
- `apps/kalio-api/src/modules/cli-agent/cli-agent-config.service.ts` — ~/.kalio/cli-agents/{id}.json
- `apps/kalio-api/src/modules/cli-agent/cli-agent.service.ts` — spawn+stream+probe
- `apps/kalio-api/src/modules/cli-agent/cli-agent.controller.ts` — REST API
- `apps/kalio-api/src/modules/cli-agent/cli-agent.module.ts`
- `apps/kalio-web/src/features/chat/LiveCLIAgentBlock.tsx` — live terminal stream
- `apps/kalio-web/src/features/settings/CLIAgentPanel.tsx` — multi-adapter settings
- `docs/cli-agent-module-architecture.md` — architecture doc with mermaid diagrams

## Files Modified

- `packages/@kalio/types/src/index.ts` — Added `CLIAgentConfig`, `CLIAgentAdapterInfo`, `cli_agent:progress` event, `_emit` on `ToolCallRequest`
- `packages/@kalio/sdk/src/index.ts` — Added `onCLIAgentProgress()`
- `apps/kalio-api/src/app.module.ts` — Registered `CLIAgentModule`
- `apps/kalio-api/src/modules/tool/tool.module.ts` — Imported `CLIAgentModule`
- `apps/kalio-api/src/modules/tool/tool.controller.ts` — Removed old `GET /api/tools/cli-agent/probe`
- `apps/kalio-api/src/modules/tool/tools/run-cli-agent.tool.ts` — Rewritten to delegate to `CLIAgentService`
- `apps/kalio-api/src/modules/tool/tools/run-cli-agent.tool.spec.ts` — Rewritten to mock `CLIAgentService`
- `apps/kalio-api/src/modules/chat/tool-dispatch.service.ts` — Pass `_emit: ctx.emit` in ToolCallRequest
- `apps/kalio-web/src/store/agentStore.ts` — Added `cliAgentOutput`, `appendCLIAgentChunk`, `clearCLIAgentOutput`
- `apps/kalio-web/src/features/chat/ChatInterface.tsx` — Subscribe `onCLIAgentProgress`
- `apps/kalio-web/src/features/chat/ToolCallBubble.tsx` — `LiveCLIAgentBlock` for running calls, `agentId` passthrough
- `apps/kalio-web/src/features/chat/TerminalOutputBlock.tsx` — Dynamic label from `agentId`
- `apps/kalio-web/src/features/settings/registry.tsx` — `CLIAgentPanel` replaces `ToolsPanel`

## Decisions

- `CLIAgentConfig` moved to `@kalio/types` (single source of truth); `cli-agent-config.service.ts` re-exports it
- `_emit` on `ToolCallRequest` is `readonly optional` — never serialized, only used at runtime by tools that need streaming
- Map typed as `Map<string, ICLIAgentAdapter>` to avoid union-type inference issues
- `setDraft` callbacks use explicit `(d: ConfigDraft)` annotation (strict TypeScript)
- Old `ToolsPanel` settings panel replaced — `CLIAgentPanel` provides per-adapter probe + config UI

## Verification

- Backend typecheck: ✅ zero errors
- Frontend typecheck: ✅ zero errors
- `run-cli-agent.tool.spec.ts`: ✅ 6/6 tests pass
