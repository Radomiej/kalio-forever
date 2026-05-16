# 2026-05-16-16-29 — Dedicated mock-backed E2E stack for Playwright

## What was done

Moved local Playwright away from the normal dev backend/frontend ports so E2E no longer attaches to a real interactive dev agent by default.

### E2E stack isolation
- Root `dev:e2e` now launches `start-dev.ps1` with dedicated ports: backend `3316`, frontend `5288`.
- `start-dev.ps1` now treats non-default ports as the dedicated E2E lane:
  - builds the API once
  - starts `dist/main.js` instead of `nest start --watch`
  - points Vite at the dedicated backend origin
- The dedicated backend now uses isolated storage:
  - DB: `./data/kalio-e2e.db`
  - workspace root: `./data/workspaces-e2e`

### Root cause fixed
- The API bootstrap in `apps/kalio-api/src/main.ts` loaded `.env` / `.env.test` with `override: true`, which prevented launcher-provided env vars from winning.
- This made a dedicated E2E backend impossible even when `start-dev.ps1` set different ports.
- Fixed by letting externally provided env vars take precedence during dotenv load.

### Frontend / Playwright config
- `apps/kalio-web/vite.config.ts` now reads `VITE_PORT`, `VITE_API_URL`, and `VITE_WS_URL` for dev server port and proxy targets.
- `apps/e2e/playwright.config.ts` now defaults to `http://localhost:5288` instead of the shared dev frontend.
- `apps/e2e/tests/helpers/test-config.ts` now defaults API requests to `http://localhost:3316/api`.
- Updated Playwright specs that hardcoded `http://localhost:5188` to use `page.goto('/')` under Playwright `baseURL`.

### Additional test drift fix
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx` now mocks `eventBus.onToolConfirmationInvalidated(...)`, matching the current runtime contract.

## Validation

### Dedicated port regression
- `apps/e2e/tests/regression-port-config.spec.ts`
- Red first: `ECONNREFUSED` on `3316` / `5288` before the launcher changes.
- Green after fix: Playwright confirmed both dedicated ports respond.

### Streaming validation
- Backend Vitest:
  - `chat.service.spec.ts`
  - `chat.service.event-ordering.spec.ts`
  - `llm-service.adapter.spec.ts`
  - `stream-processor.spec.ts`
- Frontend Vitest:
  - `sessionStore.test.ts`
  - `ChatInput.spec.tsx`
- Typecheck:
  - `apps/kalio-api` `tsc --noEmit`
  - `apps/kalio-web` `tsc --noEmit`
- Playwright:
  - `regression-port-config.spec.ts`
  - `ac-01-streaming.spec.ts`
  - `ac-10-streaming-visible.spec.ts`
  - `ac-13-anti-spam.spec.ts`
- Result: green

### RA-App validation
- Backend Vitest:
  - `raapp.service.spec.ts`
  - `raapp-versioning.service.spec.ts`
  - `raapp.controller.spec.ts`
  - `raapp-hitl.service.spec.ts`
  - `effects-processor.service.spec.ts`
- Frontend Vitest:
  - `RAAppRenderer.test.tsx`
  - `HtmlIframeRenderer.test.tsx`
  - `VfsHtmlRenderer.test.tsx`
  - `RAAppManager.test.tsx`
  - `catalog.utils.test.ts`
  - `GuiDslRenderer.test.tsx`
  - `RAAppGroupCard.test.tsx`
  - `RAAppCoreCard.test.tsx`
- Playwright:
  - `ac-10-raapp-rendering.spec.ts`
  - `ac-11-persona-system-prompt.spec.ts`
  - `ac-25-raapp-memory-tools.spec.ts`
- Result: green

## Files touched
- `package.json`
- `start-dev.ps1`
- `apps/kalio-api/src/main.ts`
- `apps/kalio-web/vite.config.ts`
- `apps/e2e/playwright.config.ts`
- `apps/e2e/tests/helpers/test-config.ts`
- `apps/e2e/tests/regression-port-config.spec.ts`
- `apps/e2e/tests/ac-04-persona-tools.spec.ts`
- `apps/e2e/tests/ac-04-persona-ui.spec.ts`
- `apps/e2e/tests/ac-04-persona-crud.spec.ts`
- `apps/e2e/tests/ac-14-session-creation.spec.ts`
- `apps/e2e/tests/ac-16-memory-hybrid-search.spec.ts`
- `apps/e2e/tests/ac-19-skills-ui.spec.ts`
- `apps/e2e/tests/ac-21-embedding-credentials.spec.ts`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`

## Open notes
- `ChatInterface.test.tsx` still has an unrelated non-streaming failure in the broader file (`message styling > applies correct classes to operator messages`). It did not block the streaming / RA-App validation slices and was left untouched.
- The dedicated E2E backend is intentionally not watch-mode. For local Playwright this is a feature, not a bug: stable isolated runtime matters more than hot reload.
