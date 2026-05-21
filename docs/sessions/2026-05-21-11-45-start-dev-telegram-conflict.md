# 2026-05-21 11:45 - start-dev Telegram conflict

## What was done

- Reproduced `start-dev.cmd` failure path and verified the initial `Vite CLI not found` message came from an incomplete local `node_modules` state, not from a launcher regression.
- Repaired the workspace install with `pnpm install` and then `pnpm install --force`, which restored missing files in the patched `@nestjs/cli` package under `node_modules/.pnpm`.
- Re-ran `start-dev.cmd` and identified the real startup crash: `TelegramRelayService` let a rejected `bot.start()` polling promise escape, so a Telegram `409 Conflict` killed the backend after bootstrap.
- Added a regression test for auto-start polling rejection and updated `TelegramRelayService` to catch async polling startup failures, clear stale connected state, and avoid logging `@null` on failed auto-start.

## Files touched

- `apps/kalio-api/src/modules/relay/telegram/telegram-relay.service.ts`
- `apps/kalio-api/src/modules/relay/telegram/telegram-relay.service.spec.ts`

## Decisions

- Kept the fix local to `TelegramRelayService` instead of changing `start-dev.ps1`, because the launcher was only exposing the backend crash.
- Preserved registered chat state on polling startup failure; the runtime bot connection is cleared, but saved relay configuration is not deleted.
- Used a narrow regression test instead of a broad dev-stack test to lock the failure mode at the owning abstraction.

## Validation

- `pnpm install`
- `pnpm install --force`
- `apps/kalio-api: vitest run src/modules/relay/telegram/telegram-relay.service.spec.ts`
- `start-dev.cmd`
- `curl.exe http://localhost:3016/api/sessions` -> `200`
- `curl.exe http://localhost:5188/` -> `200`

## Open questions

- `connect()` still depends on eventual Telegram polling success after `startBot()` returns. If the relay needs stronger API guarantees, it may be worth making connect semantics explicit for immediate polling conflicts.

## Update 12:45 - connect hardening

- Hardened `TelegramRelayService.connect()` so it now waits for polling readiness (`onStart`) or an immediate polling failure before persisting the new bot token.
- Added a regression test that proves `connect()` rejects and does not save the token when polling fails immediately.
- Added a second regression test that proves a failed replacement connect restores the previous runtime bot instead of leaving the relay disconnected.

### Extra validation

- `apps/kalio-api: vitest run src/modules/relay/telegram/telegram-relay.service.spec.ts`
- `apps/kalio-api: vitest run src/modules/relay/telegram/telegram.controller.spec.ts`
- `apps/kalio-api: tsc --noEmit`
- `start-dev.cmd`
- `curl.exe http://localhost:3016/api/sessions` -> `200`
- `curl.exe http://localhost:5188/` -> `200`