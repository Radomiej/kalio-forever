# LLM Settings Runtime Panel

## What was done
- Split LLM settings into two distinct areas: provider credentials list and runtime settings panel.
- Added a runtime-aware active model flow so the model selector works for both DB-backed active credentials and env-backed fallback providers.
- Added backend endpoints for active runtime model operations:
  - `GET /api/llm/active/models`
  - `PUT /api/llm/active/model`
- Added env model override persistence via `app_settings.env_llm_model_override` and wired `LLMService` to honor it for runtime config and provider creation.
- Extracted provider UI into `ProviderSettingsSection.tsx` and introduced shared local types in `llm-panel.types.ts`.

## Files touched
- `apps/kalio-web/src/features/settings/LLMPanel.tsx`
- `apps/kalio-web/src/features/settings/ProviderSettingsSection.tsx`
- `apps/kalio-web/src/features/settings/ModelSettingsSection.tsx`
- `apps/kalio-web/src/features/settings/llm-panel.types.ts`
- `apps/kalio-web/src/features/settings/LLMPanel.test.tsx`
- `apps/kalio-web/src/features/settings/ModelSettingsSection.test.tsx`
- `apps/kalio-api/src/modules/llm/llm.controller.ts`
- `apps/kalio-api/src/modules/llm/llm.service.ts`
- `apps/kalio-api/src/modules/llm/llm.controller.spec.ts`
- `apps/kalio-api/src/modules/llm/llm.service.spec.ts`
- `apps/kalio-api/src/modules/credentials/credentials.service.ts`

## Decisions
- Kept provider credentials management separate from runtime settings to match the intended UX.
- Used a unified runtime model API instead of credential-only model endpoints in the settings panel.
- Preserved DB credential model updates for active saved providers while adding env fallback model override support.
- Returned updated runtime config from the active-model endpoint so the UI can sync immediately after save.

## Open questions
- The env model override currently persists until changed again; there is no explicit "reset to env default" action in the UI yet.
- Existing error-path tests intentionally log to stderr during expected failures; no suppression was added.

## Verification
- `apps/kalio-web`: `vitest run src/features/settings/LLMPanel.test.tsx src/features/settings/ModelSettingsSection.test.tsx`
- `apps/kalio-api`: `vitest run src/modules/llm/llm.controller.spec.ts src/modules/llm/llm.service.spec.ts`
- `apps/kalio-web`: `tsc --noEmit`
- `apps/kalio-api`: `tsc --noEmit`

## Next steps
- If needed, add an explicit UI control to clear the env model override and revert to the raw `LLM_MODEL` value.
