# Session Log — Max Tool Attempts Setting

## What was done
- Added backend setting `max_tool_attempts` persisted in `app_settings` via `CredentialsService`.
- Exposed new API endpoints:
  - `GET /api/credentials/settings/max-tool-attempts`
  - `PUT /api/credentials/settings/max-tool-attempts`
- Extended `GET /api/llm/config` to include `maxToolAttempts`.
- Replaced hardcoded chat loop cap in `ChatService` with configurable value from settings.
- Propagated setting into sub-agent execution:
  - `SubagentTool` now reads configured max attempts and passes `maxIterations` to runtime.
  - `SubagentRuntimeService` now uses per-request configurable loop cap (clamped).
- Added UI control in `LLMPanel` for max tool attempts (range 1-100), persisted via API.
- Extended frontend config typing/store to carry `maxToolAttempts`.

## Files touched
- `apps/kalio-api/src/modules/credentials/credentials.service.ts`
- `apps/kalio-api/src/modules/credentials/credentials.controller.ts`
- `apps/kalio-api/src/modules/llm/llm.controller.ts`
- `apps/kalio-api/src/modules/chat/chat.service.ts`
- `apps/kalio-api/src/modules/chat/chat.module.ts`
- `apps/kalio-api/src/modules/tool/subagent-runtime.port.ts`
- `apps/kalio-api/src/modules/tool/tools/subagent.tool.ts`
- `apps/kalio-api/src/modules/chat/subagent-runtime.service.ts`
- `apps/kalio-api/src/modules/tool/tool.module.ts`
- `apps/kalio-web/src/features/settings/settingsStore.ts`
- `apps/kalio-web/src/features/settings/LLMPanel.tsx`
- `apps/kalio-web/src/App.tsx`
- Tests updated:
  - `apps/kalio-api/src/modules/credentials/credentials.service.spec.ts`
  - `apps/kalio-api/src/modules/credentials/credentials.controller.spec.ts`
  - `apps/kalio-api/src/modules/llm/llm.controller.spec.ts`
  - `apps/kalio-api/src/modules/chat/__tests__/agent-loop-limits.spec.ts`
  - `apps/kalio-api/src/modules/tool/tools/subagent.tool.spec.ts`
  - `apps/kalio-web/src/features/settings/LLMPanel.test.tsx`

## Decisions
- Clamp configured attempts to `[1, 100]` to prevent runaway loops.
- Keep default value at `8` for backward behavior, but make test tuning possible (e.g. `25`).
- Apply one shared setting to both main chat loop and sub-agent loop for predictable behavior.

## Verification
- Backend tests passed (84/84) for affected suites.
- Frontend LLM panel tests passed (17/17).
- Typecheck passed for `kalio-api` and `kalio-web`.

## Next steps
- Optional: expose a tooltip in UI explaining interaction with confirmation waits and long-running tool chains.
- Optional: add observability metric for "loop reached limit" frequency to guide default tuning.
