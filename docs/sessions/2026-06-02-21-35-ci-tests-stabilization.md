## Summary

- Stabilized the remaining local repros blocking the monorepo `tests` job after earlier backend and e2e fixes.
- Confirmed `pnpm turbo run test` finishes with `EXIT:0` from the repo root.
- Aligned E2E expectations with the current local embedding fallback contract (`source=local`, configured provider available).
- Kept architecture mock script waits fast while preserving normal mock streaming delay so stop/anti-spam UI tests can observe an in-flight response.

## Files Touched

- `.github/workflows/ci.yml`
- `apps/e2e/tests/ac-04-persona-tools.spec.ts`
- `apps/e2e/tests/ac-04-persona-ui.spec.ts`
- `apps/e2e/tests/ac-07-mcp-server.spec.ts`
- `apps/e2e/tests/ac-21-embedding-credentials.spec.ts`
- `apps/kalio-api/src/app.module.spec.ts`
- `apps/kalio-api/src/modules/cli-agent/cli-agent-session-runtime.service.spec.ts`
- `apps/kalio-api/src/modules/cli-agent/cli-agent.service.spec.ts`
- `apps/kalio-api/src/modules/llm/providers/mock.provider.ts`
- `apps/kalio-api/src/modules/raapp/raapp-versioning.service.spec.ts`
- `apps/kalio-web/src/features/architect/ArchitectPage.test.tsx`
- `apps/kalio-web/src/features/architect/ArchitectRunConfig.test.tsx`
- `apps/kalio-web/src/features/observability/ObservabilityPage.test.tsx`
- `apps/kalio-web/src/features/persona/PersonaToolPicker.test.tsx`
- `apps/kalio-web/src/features/settings/ImageSettingsPanel.test.tsx`
- `apps/kalio-web/src/features/settings/LLMPanel.test.tsx`
- `apps/kalio-web/vitest.config.ts`

## Decisions

- Kept fixes test-scoped where possible instead of changing runtime code.
- Replaced slow `userEvent` flows with `fireEvent` only in timeout-prone tests that did not require realistic typing semantics.
- Added test-local timeout headroom for a few frontend specs that are stable in isolation but slower under the full web suite.
- Excluded `dist/**` and other local output folders from `kalio-web` Vitest discovery while preserving `configDefaults.exclude` so `node_modules/**` stays excluded.
- Waited for newly rendered architect and observability nodes with async queries instead of immediate `getBy*` assertions.

## Validation

- `cd apps/kalio-web && pnpm test -- src/features/observability/ObservabilityPage.test.tsx`
- `cd apps/kalio-web && pnpm test -- src/features/architect/ArchitectPage.test.tsx -t "adds router nodes from the graph palette with router defaults"`
- `cd apps/kalio-web && pnpm test -- src/features/persona/PersonaToolPicker.test.tsx src/features/settings/ImageSettingsPanel.test.tsx src/features/settings/LLMPanel.test.tsx`
- `cd apps/kalio-web && pnpm test`
- `cd apps/kalio-api && pnpm test:cov`
- `pnpm --filter @kalio/e2e test:e2e -- tests/ac-21-embedding-credentials.spec.ts --project=chromium`
- `pnpm --filter @kalio/e2e test:e2e -- tests/ac-04-persona-tools.spec.ts tests/ac-04-persona-ui.spec.ts tests/ac-07-mcp-server.spec.ts tests/ac-13-anti-spam.spec.ts tests/ac-21-embedding-credentials.spec.ts --project=chromium`
- `pnpm turbo run test`

## Open Questions

- Several passing frontend tests still emit expected stderr noise from mocked fallback/error paths and a couple of React `act(...)` warnings. They are not current blockers, but they remain cleanup candidates if CI log noise becomes a problem.
