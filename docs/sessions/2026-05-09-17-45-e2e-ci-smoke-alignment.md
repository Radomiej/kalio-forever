# E2E CI Smoke Alignment

## What was done

- Made core RA-App availability deterministic in CI by adding packaged seed apps and teaching `RAAppService` to fall back to built-in assets when runtime `data/ra-apps/core` is absent.
- Added and verified a regression test for the packaged core fallback in `raapp.service.spec.ts`.
- Triaged Playwright failures under the GitHub Actions-like profile (`CI=true`, `LLM_PROVIDER=mock`, `TEST_API_URL=http://127.0.0.1:3016/api`).
- Marked MockLLM-incompatible E2E expectations as skipped under the mock provider for tool-call visibility and semantic history recall.
- Updated stale tool metadata E2E expectations so they match current backend confirmation policy.
- Skipped the stale agent-loop CRUD E2E because the backend feature was removed and the DB migration explicitly drops the tables/endpoints.
- Re-ran the full Chromium E2E suite and confirmed it finishes green with expected skips.

## Files touched

- `apps/kalio-api/src/modules/raapp/raapp.service.ts`
- `apps/kalio-api/src/modules/raapp/raapp.service.spec.ts`
- `apps/kalio-api/src/assets/ra-apps/core/qa-interactive/meta.yml`
- `apps/kalio-api/src/assets/ra-apps/core/qa-interactive/ui.gui`
- `apps/kalio-api/src/assets/ra-apps/core/qa-interactive/systems.yml`
- `apps/kalio-api/src/assets/ra-apps/core/visual-calculator/meta.yml`
- `apps/kalio-api/src/assets/ra-apps/core/visual-calculator/ui.gui`
- `apps/kalio-api/src/assets/ra-apps/core/visual-calculator/systems.yml`
- `apps/e2e/tests/ac-11-tool-call-visible.spec.ts`
- `apps/e2e/tests/ac-13-multi-turn-history.spec.ts`
- `apps/e2e/tests/ac-18-kv-tools.spec.ts`
- `apps/e2e/tests/ac-20-agent-loop-crud.spec.ts`
- `apps/e2e/tests/ac-25-raapp-memory-tools.spec.ts`

## Decisions made

- CI must not depend on ignored local runtime data under `apps/kalio-api/data/**`.
- `MockLLMProvider` is only suitable for smoke coverage of request/response plumbing; tests that require tool planning or semantic recall must skip or run in a separate non-mock job.
- `raapp_create`, `memory_ingest`, and `memory_ingest_conversation` are treated as confirmation-requiring mutating tools in E2E because that matches the current backend decorators and unit tests.
- AC-20 is a stale test for removed functionality, not a backend regression.

## Validation

- `pnpm exec vitest run src/modules/raapp/raapp.service.spec.ts`
- `pnpm --filter kalio-api build`
- `pnpm --filter @kalio/e2e exec playwright test tests/ac-20-agent-loop-crud.spec.ts tests/ac-25-raapp-memory-tools.spec.ts --project=chromium`
- `pnpm --filter @kalio/e2e exec playwright test --project=chromium`
- Final Playwright result: `139 passed`, `13 skipped`, `0 failed`.

## Open questions

- The skipped MockLLM-only E2E slices should eventually be covered by a separate provider profile if CI needs semantic/tool-planning assertions.
- AC-20 could be deleted entirely in a later cleanup instead of remaining as an explicit skip documenting removed scope.

## Next steps

- If desired, split Playwright into a fast mock smoke lane and a smaller non-mock behavior lane.
- If CI duration becomes a concern again, consider sharding Chromium tests after preserving the current deterministic environment assumptions.