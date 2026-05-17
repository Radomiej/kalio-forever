# 2026-05-12 — Telegram Relay + Escalate Tool

## What was done

Implemented full Telegram integration, a generic `RemoteRelayChannel` abstraction, and a native `escalate` tool for agents.

### New files
- `apps/kalio-api/src/modules/relay/remote-relay-channel.interface.ts` — abstract base class for notification channels
- `apps/kalio-api/src/modules/relay/relay-command-handlers.interface.ts` — interface for stop/status callbacks
- `apps/kalio-api/src/modules/relay/relay.service.ts` — aggregates channels, provides `broadcast()`
- `apps/kalio-api/src/modules/relay/telegram/telegram.utils.ts` — MarkdownV2 escaping + message chunking
- `apps/kalio-api/src/modules/relay/telegram/telegram-relay.service.ts` — grammY bot (polling), connect/disconnect, `/status` `/stop` commands
- `apps/kalio-api/src/modules/relay/telegram/telegram.controller.ts` — REST: `GET/POST/DELETE /api/relay/telegram/connect`
- `apps/kalio-api/src/modules/relay/relay.module.ts` — NestJS module definition
- `apps/kalio-api/src/modules/tool/tools/escalate.tool.ts` — native `escalate` tool for agents
- `apps/kalio-web/src/features/settings/TelegramSettings.tsx` — UI panel to connect/disconnect Telegram

### Modified files
- `packages/@kalio/types/src/index.ts` — added `'escalation'` to `AuditType` union
- `apps/kalio-api/src/database/schema.ts` — added `'escalation'` to auditLog table enum
- `apps/kalio-api/package.json` — added `grammy ^1.42.0`
- `apps/kalio-api/src/modules/tool/tool.providers.ts` — registered `EscalateTool`
- `apps/kalio-api/src/modules/tool/tool-registry.service.ts` — injected `EscalateTool`
- `apps/kalio-api/src/modules/tool/tool-registry.service.spec.ts` — added `EscalateTool` stub + `'escalate'` to EXPECTED_TOOLS
- `apps/kalio-api/src/config/tool-application-config.module.ts` — imported `RelayModule`
- `apps/kalio-api/src/app.module.ts` — imported `RelayModule`
- `apps/kalio-api/src/modules/chat/chat.module.ts` — wired `TelegramRelayService.setCommandHandlers()` via `OnModuleInit`
- `apps/kalio-api/src/modules/chat/session-pipeline.service.ts` — added `getActiveSessionIds()` getter
- `apps/kalio-api/src/modules/chat/chat.service.ts` — added escalation audit hook after tool_result for `escalate` tool
- `apps/kalio-web/src/features/settings/registry.tsx` — added Telegram tab with `Send` icon
- `apps/kalio-web/src/features/audit/AuditLogPanel.tsx` — added `escalation` to `TYPE_CONFIG`
- `apps/kalio-web/src/features/observability/ObservabilityPage.tsx` — added `escalation` to `TYPE_CONFIG`

## Design decisions
- **Polling only** — no webhook setup required, simpler for single-user self-hosted deployment
- **Single user** — one `bot_token` + `chat_id` stored as app-level settings (not per-user)
- **`/stop` stops ALL active sessions** — aligns with single-user assumption
- **No severity enum on escalate** — simple string `message`, keeps tool surface minimal
- **Circular dep avoidance** — ChatModule wires TelegramRelayService command handlers in `onModuleInit()` to avoid circular injection between ChatModule and RelayModule

## Bugs fixed during implementation
- `escalate.tool.ts`: used `request.parameters` (doesn't exist) instead of `request.args` — fixed
- `tool-registry.service.spec.ts`: constructor stub count was 53 instead of 54 after adding EscalateTool — fixed

## Verification
- Backend typecheck: ✅ 0 errors
- Frontend typecheck: ✅ 0 errors
- `tool-registry.service.spec.ts`: ✅ 8/8 tests pass

## Open questions / next steps
- E2E test for Telegram connect/disconnect flow (requires a real bot token)
- Consider adding a `severity` field to `escalate` tool if urgency tiers are needed later
- `/stop` command currently stops all sessions at once — might want to support `sessionId` argument later
