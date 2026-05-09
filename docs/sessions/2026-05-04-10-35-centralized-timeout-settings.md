# Session Log — Centralized Timeout Settings

## What was done
- Added a centralized `TimeoutSettingsService` backed by `app_settings` for tool-related timeouts.
- Exposed timeout settings via `GET/PUT /api/credentials/settings/tool-timeouts`.
- Switched `web_search` to read its timeout from the centralized service.
- Switched provider probe/test timeouts in `LLMController`, `CredentialsService`, and `CredentialsController` to the centralized service.
- Exposed the new timeout settings in the Settings UI next to `maxToolAttempts`.

## Timeout settings added
- `webSearchTimeoutMs`
- `providerLocalTimeoutMs`
- `providerRemoteTimeoutMs`

## Storage and bounds
- Stored in `app_settings` under dedicated `tool_timeout_*` keys.
- `webSearchTimeoutMs`: 15s to 600s, default 120s.
- `providerLocalTimeoutMs`: 1s to 30s, default 3s.
- `providerRemoteTimeoutMs`: 5s to 120s, default 15s.

## Files touched
- `apps/kalio-api/src/modules/credentials/timeout-settings.service.ts`
- `apps/kalio-api/src/modules/credentials/credentials.controller.ts`
- `apps/kalio-api/src/modules/credentials/credentials.service.ts`
- `apps/kalio-api/src/modules/credentials/credentials.module.ts`
- `apps/kalio-api/src/modules/llm/llm.controller.ts`
- `apps/kalio-api/src/modules/search/web-search.service.ts`
- `apps/kalio-api/src/modules/search/search.module.ts`
- `apps/kalio-web/src/features/settings/LLMPanel.tsx`
- related tests

## Verification
- Backend:
  - `node_modules\\.bin\\vitest.CMD run src/modules/credentials/timeout-settings.service.spec.ts src/modules/credentials/credentials.controller.spec.ts src/modules/llm/llm.controller.spec.ts src/modules/search/web-search.service.spec.ts src/modules/credentials/credentials.service.spec.ts`
  - result: passing
- Frontend:
  - `pnpm vitest run src/features/settings/LLMPanel.test.tsx`
  - result: passing

## Decisions made
- Kept timeout settings in a dedicated backend service instead of extending `CredentialsService` further with more app-level configuration logic.
- Exposed only user-tunable network/tool timeouts.
- Did not expose internal safety timeouts like RAApp sandbox limits or CLI-agent caps in this pass.

## Next steps
- If needed, move `contextWindow`, `maxToolAttempts`, and timeout settings behind one broader runtime settings service/API to reduce the remaining split across services.