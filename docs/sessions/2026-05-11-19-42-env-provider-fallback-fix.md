# Env Provider Fallback Fix

## What was done

- Added frontend regressions for env fallback selection, env/saved-provider model switching, stale env refresh handling, and browser-cache bypassing in the LLM settings panel.
- Reworked the env fallback option in the LLM providers list so it renders as a provider row with the same activation affordance as saved credentials.
- Updated the LLM settings frontend to remember the last known env runtime config and reuse it when switching back from a saved credential.
- Disabled browser caching for GET requests in the LLM settings API wrappers to avoid stale `/api/llm/config` and `/api/credentials/active` reads in the browser.
- Added a backend routing regression proving that `DELETE /credentials/active` must hit `clearActiveCredential()` instead of the generic `remove(':id')` route.
- Fixed the credentials controller route ordering so `DELETE /credentials/active` is no longer shadowed by `DELETE /credentials/:id`.

## Files touched

- `apps/kalio-web/src/features/settings/LLMPanel.tsx`
- `apps/kalio-web/src/features/settings/ProviderSettingsSection.tsx`
- `apps/kalio-web/src/features/settings/ModelSettingsSection.tsx`
- `apps/kalio-web/src/features/settings/LLMPanel.test.tsx`
- `apps/e2e/tests/llm-panel.spec.ts`
- `apps/kalio-api/src/modules/credentials/credentials.controller.ts`
- `apps/kalio-api/src/modules/credentials/credentials.controller.spec.ts`

## Decisions

- Kept the env fallback in the same visual pattern as normal provider rows instead of a separate special-case button.
- Fixed the frontend stale-state issue in two layers: optimistic env snapshot reuse and `cache: 'no-store'` for settings GET requests.
- Fixed the backend at the real root cause by moving the static `active` delete route above the generic `:id` delete route.

## Validation

- `apps/kalio-web`: `vitest run src/features/settings/LLMPanel.test.tsx` -> 38 passing
- `apps/kalio-web`: `tsc --noEmit` -> passing
- `apps/kalio-api`: `vitest run src/modules/credentials/credentials.controller.spec.ts` -> 25 passing
- `apps/kalio-api`: `tsc --noEmit` -> passing
- Direct backend probe: `DELETE /api/credentials/active` now returns `204`, `GET /api/credentials/active` returns `null`, and `GET /api/llm/config` returns `source=env`
- `apps/e2e`: `playwright test tests/llm-panel.spec.ts` -> 9 passing

## Open questions

- None in this slice.

## Next steps

- If similar settings screens read highly volatile backend state, apply the same `cache: 'no-store'` rule there instead of relying on browser defaults.