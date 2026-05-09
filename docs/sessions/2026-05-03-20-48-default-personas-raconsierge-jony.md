# Session Log — Default personas, Jony, and RaConsierge rename

## What was done
- Updated seeded personas in `apps/kalio-api/src/assets/personas.json`:
  - Renamed display names:
    - `ra-apps` -> `RaConsierge`
    - `builder` -> `RaBuilder`
    - `designer` -> `UX Designer`
    - `dev` -> `Fullstack Dev`
  - Refined prompts for `ra-apps` (now branded as RaConsierge) and kept specialist behavior for builder/designer/dev.
  - Added new default personas:
    - `skill-persona-maker` (`Skill & Persona Maker`)
    - `jony` (`Jony`) as autonomous handyman persona that selects appropriate skill/path and solves end-to-end.
- Updated bootstrap sync behavior in `apps/kalio-api/src/modules/persona/persona.service.ts`:
  - Existing personas now also update `name` from config during `onApplicationBootstrap`.
  - Kept BUG-5 guard intact: no `systemPrompt` overwrite on existing personas.
- Updated frontend labels and copy:
  - `apps/kalio-web/src/App.tsx`: Tools tab label `RA-Apps` -> `RaConsierge`.
  - `apps/kalio-web/src/features/tools/tool.utils.ts`: group label `RA-Apps` -> `RaConsierge`.
  - `apps/kalio-web/src/features/persona/PersonaToolPicker.tsx`: group label `RA-Apps` -> `RaConsierge`.
  - `apps/kalio-web/src/features/raapp/RAAppManager.tsx`: session empty-state copy updated to RaConsierge wording.
  - `apps/kalio-web/src/features/landing/LandingPage.tsx`: empty-state copy updated to RaConsierge wording.
  - `apps/kalio-web/src/features/settings/ToolsPanel.tsx`: persona hint changed from `Dev` to `Fullstack Dev`.
- Updated E2E coverage in `apps/e2e/tests/ac-11-persona-system-prompt.spec.ts`:
  - Added assertions for renamed default persona labels.
  - Added assertions for new personas (`skill-persona-maker`, `jony`).
  - Added assertion that Tools shows renamed `RaConsierge` tab.
  - Migrated stale Settings->Personas checks to current Mind->Personas flow.

## Tests and verification
- Backend unit tests:
  - `pnpm vitest run src/modules/persona/persona.service.spec.ts` (from `apps/kalio-api`) ✅
- Frontend unit tests:
  - `pnpm vitest run src/features/landing/LandingPage.test.tsx` (from `apps/kalio-web`) ✅
- Playwright E2E:
  - `pnpm playwright test tests/ac-11-persona-system-prompt.spec.ts` (from `apps/e2e`) ✅ (7 passed)

## Key decisions
- Kept persona IDs unchanged (`ra-apps`, `builder`, `designer`, `dev`) to avoid breaking existing references/session behavior; changed only display names and prompts.
- Added name synchronization in bootstrap updates so existing databases receive renamed labels without requiring manual migration.
- Avoided changing API routes/tool names tied to RA app backend (`/api/ra-apps`, `run_raapp`, `list_raapps`) to preserve compatibility.

## Open questions / next steps
- Consider whether additional seeded personas should be treated as non-deletable system personas in UI (currently only `default` and `ra-apps` are protected in Settings Personas panel).
- Optional consistency pass: update remaining non-user-facing comments mentioning `RA-Apps` if desired.
