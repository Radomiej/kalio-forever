# 2026-05-11 22:05 - Review batch: LLM settings provider test + provider guards

## What was done

- Triaged the second pasted review batch against the current branch before changing code.
- Confirmed the `POST /credentials/test` route-shadowing comment was stale on this branch by adding and passing an HTTP regression test; no controller reorder was needed.
- Switched the LLM settings provider test flow from `GET /api/llm/models?...apiKey=...` to `POST /api/credentials/test` so API keys no longer travel in query strings.
- Updated the LLM settings delete-active-credential flow to restore the last env runtime snapshot immediately and refresh with `expectedSource: 'env'`, matching the env-fallback path.
- Hardened `resolveLlmProviderBaseUrl()` and `buildProviderCompatHeaders()` against non-string `provider` values.
- Hardened `LLMController.getModels()` against duplicated query params (`string[]`) for `provider`, and normalized optional string query values before building headers / base URLs.

## Files touched

- `apps/kalio-web/src/features/settings/LLMPanel.tsx`
- `apps/kalio-web/src/features/settings/LLMPanel.test.tsx`
- `apps/kalio-api/src/common/utils/llm-provider-http.util.ts`
- `apps/kalio-api/src/common/utils/llm-provider-http.util.spec.ts`
- `apps/kalio-api/src/modules/llm/llm.controller.ts`
- `apps/kalio-api/src/modules/llm/llm.controller.spec.ts`
- `apps/kalio-api/src/modules/credentials/credentials.controller.spec.ts`

## Decisions made

- Provider connectivity checks now use the existing backend test endpoint instead of the ad-hoc model-list endpoint because the backend route keeps secrets in the JSON body and is already testable.
- The active-credential delete path now mirrors the env-fallback activation path by reusing the last env runtime snapshot when available, instead of trusting the first post-delete `/api/llm/config` read.
- The LLM provider HTTP utility was made defensive instead of assuming typed callers, because query params and future direct callers are runtime trust boundaries.
- The `POST /credentials/test` review finding was treated as stale after the new HTTP regression passed without any production change.

## Validation

- `apps/kalio-api`: `vitest run src/modules/credentials/credentials.controller.spec.ts src/modules/llm/llm.controller.spec.ts src/common/utils/llm-provider-http.util.spec.ts` -> pass (45 tests)
- `apps/kalio-web`: `vitest run src/features/settings/LLMPanel.test.tsx` -> pass (40 tests)
- `apps/kalio-api`: `tsc --noEmit` -> pass
- `apps/kalio-web`: `tsc --noEmit` -> pass

## Open questions / deferred items

- The review notes about `App.tsx` typing `LLMConfigWithSource` without `apiKey` are still a type-hygiene issue, but were not changed in this slice because the runtime path is already safe and this batch focused on behavior/security regressions.
- `BaseOpenAICompatibleProvider.buildHeaders()` still always sends `Authorization: Bearer ` when `apiKey` is empty; that remains a separate pre-existing backend follow-up.
- The `run_subagent` child-image dedup key using the full data URL was not changed in this slice.
- The `resolveServePath()` query-string issue from the pasted review was already fixed in the previous batch and was not touched here.