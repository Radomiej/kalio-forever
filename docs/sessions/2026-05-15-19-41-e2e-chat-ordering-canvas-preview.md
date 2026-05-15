# E2E Chat Ordering And Canvas Preview

## What was done

- Added a deterministic Playwright regression spec in `apps/e2e/tests/regression-chat-ordering-canvas-preview.spec.ts`.
- Seeded the fixture directly into `apps/kalio-api/data/kalio.db` from the spec so the test does not depend on live LLM behavior.
- Covered three user-visible checks in one flow:
  - main Talk transcript keeps the later agent turn under the correct user prompt
  - canvas sub-agent previews stay ordered old to new, with the newest preview at the bottom
  - opening the newer preview shows the child transcript in chronological `user -> agent-turn` order

## Files touched

- `apps/e2e/tests/regression-chat-ordering-canvas-preview.spec.ts`
- `docs/sessions/2026-05-15-19-41-e2e-chat-ordering-canvas-preview.md`

## Decisions

- Did not rely on prompt-driven subagent creation because that would make the spec provider-dependent and flaky.
- Did not add a new dependency to `apps/e2e`; the spec resolves `better-sqlite3` through the backend package that already owns it.
- Kept the assertions scoped to the specific regression path instead of widening into a broader chat-history smoke test.

## Validation

- `Invoke-WebRequest http://localhost:5188` -> `200`
- `Invoke-WebRequest http://localhost:3016/api/sessions` -> `200`
- `pnpm --filter @kalio/e2e exec playwright test tests/regression-chat-ordering-canvas-preview.spec.ts --project=chromium` -> `1 passed`

## Open questions

- None in this slice.

## Next steps

- If this path becomes a recurring pattern, extract the SQLite seeding helpers into a shared E2E helper instead of repeating them across specs.