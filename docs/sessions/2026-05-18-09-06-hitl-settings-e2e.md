# Session: HITL Settings E2E

**Date**: 2026-05-18  
**Topic**: Deterministic Playwright coverage for HITL settings modes

## What Was Done

Completed end-to-end coverage for the new global HITL modes in Settings.

### E2E scope
- Added Playwright coverage for `manual` mode:
  - regular tool call shows confirmation UI
  - RA-App shows HITL overlay and executes after approve
- Added Playwright coverage for `bypass` mode:
  - regular tool call executes without confirmation UI
  - RA-App executes without overlay

### Deterministic test hooks
- Added a mock-LLM trigger for a plain `vfs_write` tool call so the standard tool path can be exercised without freeform model behavior.
- Added backend test-support route `POST /api/test-support/raapp-hitl/seed`.
- The new seed route uses `RAAppHITLService.resolvePendingApprovals()` so seeded RA-App history follows the same `manual` / `bypass` policy as runtime behavior.

### Spec stabilization
- Removed brittle waits for composer re-enable from the Playwright spec.
- Switched the spec to verify VFS side effects instead of depending on a specific history chip render.
- Kept env-mock provider detection via API instead of creating a DB credential with `baseUrl: 'mock'`.

## Files Touched

- `apps/e2e/tests/hitl-settings-modes.spec.ts`
- `apps/kalio-api/src/modules/llm/providers/mock.provider.ts`
- `apps/kalio-api/src/modules/llm/providers/mock.provider.spec.ts`
- `apps/kalio-api/src/modules/chat/chat-test-support.service.ts`
- `apps/kalio-api/src/modules/chat/chat-test-support-raapp.controller.ts`
- `apps/kalio-api/src/modules/chat/chat.module.ts`

## Validation

- `npx playwright test tests/hitl-settings-modes.spec.ts --project=chromium` from `apps/e2e` → 2 passed
- `get_errors` on touched backend, mock-provider, and E2E files → no errors

## Decisions

- Use real `RAAppHITLService` inside test support instead of a parallel fake policy path.
- Prefer filesystem side effects for E2E assertions when chat bubble rendering is timing-sensitive.
- Keep the seed endpoint test-only via the existing `NODE_ENV === 'test'` guard in `ChatTestSupportService`.

## Open Questions

- None for this slice.
