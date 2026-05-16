# 2026-05-12 10:40 - review regression sweep

## What was done

Reviewed the supplied review findings against the current branch, separated already-fixed items from still-open issues, and closed the remaining confirmed gaps with regression tests first.

Implemented:
- `LLMController.updateActiveModel()` now validates the trimmed body value but delegates the raw string to `LLMService`, so normalization happens in one place
- `LLMService` constructor now normalizes env `baseUrl: 'mock'` to `undefined` up front, preventing the fallback provider cache key from changing on the first runtime use
- `PersonaService.shouldRefreshSeededSystemPrompt()` now treats `image_edit` the same as `image_generate`/`image_view` when deciding whether a stored designer prompt is still the old seed or already user-customized

Confirmed already-fixed review items with tests and source inspection:
- VFS `serve-path` strips query strings
- `llm-provider-http.util` safely handles non-string provider input and whitespace base URLs
- `ToolCallBubble` child image dedup does not use huge raw data URLs as identities
- `LLMConfigWithSource` includes optional `apiKey`
- provider test flow uses `POST /api/credentials/test` request body instead of leaking API keys in query params
- removing the active credential restores env runtime with stale-refresh protection
- base OpenAI-compatible providers omit empty `Authorization`
- duplicate `provider` query params for `/api/llm/models` are rejected safely
- `POST /credentials/test` is explicitly covered and routes to `testConnection`

## Tests added/updated

Added regressions for:
- controller-side single-place model normalization contract
- stable fallback env-provider key when the configured base URL is `mock`
- preserving a customized VFS-first designer prompt that already mentions `image_edit`

## Validation

Focused backend sweep:
- `npm run test --prefix apps/kalio-api -- src/modules/vfs/session-vfs.controller.spec.ts src/modules/credentials/credentials.controller.spec.ts src/common/utils/llm-provider-http.util.spec.ts src/modules/llm/providers/base-openai-compatible.provider.spec.ts src/modules/llm/llm.controller.spec.ts src/modules/llm/llm.service.spec.ts src/modules/persona/persona.service.spec.ts --run`

Focused frontend sweep:
- `npm run test --prefix apps/kalio-web -- src/features/settings/LLMPanel.test.tsx src/features/chat/ToolCallBubble.test.tsx src/features/raapp/VfsHtmlRenderer.test.tsx src/App.test.tsx --run`

Static checks:
- `get_errors` on touched files returned no errors

## Files touched

- `apps/kalio-api/src/modules/llm/llm.controller.ts`
- `apps/kalio-api/src/modules/llm/llm.service.ts`
- `apps/kalio-api/src/modules/persona/persona.service.ts`
- `apps/kalio-api/src/modules/llm/llm.controller.spec.ts`
- `apps/kalio-api/src/modules/llm/llm.service.spec.ts`
- `apps/kalio-api/src/modules/persona/persona.service.spec.ts`

## Decisions

- Did not change `VfsHtmlRenderer` preflight auth behavior. The review note there is a trade-off/risk note, not a confirmed bug, and the current no-credentials preflight is intentional for the dev CORS fix.
- Did not add speculative cleanup beyond the confirmed review items. The sweep stayed limited to bugs or defensive gaps that still reproduced on the current branch.

## Next steps

- If you want stronger guardrails, the next useful pass is an HTTP-level sweep of the remaining settings endpoints and route precedence, but the highest-risk review items are now covered.