# 2026-05-12 00:45 - review batch child reconnect contracts

## What was done

Closed the deferred review items around App/provider/ToolCallBubble typing/runtime alignment and fixed the child-confirmation reconnect regression in ChatGateway.

Implemented:
- `ChatGateway.handleSessionIdentify()` now replays pending confirmations for the identified parent session and all descendant sessions, while re-owning replayed child sessions so confirm/cancel works after reconnect.
- `BaseOpenAICompatibleProvider.buildHeaders()` now omits `Authorization` when `apiKey` is empty instead of sending `Bearer `.
- `ToolCallBubble` child-image dedup now prefers VFS `path` and hashes inline image URLs for fallback identities, avoiding huge data-URL keys.
- `LLMConfigWithSource` now allows optional `apiKey` from `/api/llm/config`.
- Shared `AgentRunContext` in `@kalio/types` now includes optional `autoApproveTools` and `subagentDepth` to match backend payloads already emitted by subagent runtime.

## Tests added/updated

Added regressions for:
- parent re-identify replaying child confirmations and allowing child confirm afterward
- omitting empty Authorization header
- ToolActivity accepting backend `agentRun` metadata (`autoApproveTools`, `subagentDepth`)
- child-image dedup by shared VFS path
- frontend runtime config type accepting backend `apiKey`

## Validation

Focused Vitest:
- `chat.gateway.spec.ts`
- `base-openai-compatible.provider.spec.ts`
- `subagent-runtime.service.spec.ts`
- `tool-dispatch.service.spec.ts`
- `ToolCallBubble.test.tsx`
- `App.test.tsx`

Focused typecheck:
- `apps/kalio-api` `tsc --noEmit`
- `apps/kalio-web` `tsc --noEmit`

Playwright smoke:
- `llm-panel.spec.ts`: settings modal + env fallback credential switch
- `ac-14-session-creation.spec.ts`: new session creation and listing

Live browser assessment:
- confirmed running app tab on `http://localhost:5188/`
- landing content loaded normally
- no deterministic manual-MCP seed path exists yet for reproducing child HITL reconnect from the live UI alone, so that slice remains validated by regression tests rather than a manual browser reproduction

## Files touched

- `apps/kalio-api/src/modules/chat/chat.gateway.ts`
- `apps/kalio-api/src/modules/chat/__tests__/chat.gateway.spec.ts`
- `apps/kalio-api/src/modules/llm/providers/base-openai-compatible.provider.ts`
- `apps/kalio-api/src/modules/llm/providers/base-openai-compatible.provider.spec.ts`
- `apps/kalio-web/src/features/chat/ToolCallBubble.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.test.tsx`
- `apps/kalio-web/src/features/settings/llm-panel.types.ts`
- `apps/kalio-web/src/App.test.tsx`
- `packages/@kalio/types/src/index.ts`

## Decisions

- Did not silently change `raapp_create` auto-approve policy. The review raised a safety-analysis concern, but current evidence did not prove a concrete regression and changing the allowlist would be a product/runtime behavior change.
- Did not attempt a speculative fix for the remaining stale-confirmation replay race. The reconnect/ownership bug is fixed, but a fully stale button after the confirmation disappears remains an architectural UX issue and needs a separate decision.

## Next steps

- If the next review batch still wants browser coverage for child reconnect approvals, add an explicit deterministic E2E seed path for pending child confirmations instead of relying on manual UI setup.
- Revisit `raapp_create` auto-approve only with a concrete safety policy for filesystem writes and overwrite behavior.

## Open follow-up risks

- Stale confirmation remains unresolved at the protocol level until E2E can deterministically seed and invalidate replayed child approvals. The reconnect/ownership fix restored live child approvals correctly, but the broader requirement is that frontend approval UI must follow backend invalidation, not assume a local click resolved the request.
- `raapp_create` child auto-approve was left open intentionally because it is a policy decision, not a proven reconnect regression. The tool itself is still confirmation-required because it creates durable catalog state.
- Recommended direction: keep an explicit `tool:confirmation_invalidated` cleanup path for timeout, cancel, confirm-from-another-client, and not-found clicks; remove `raapp_create` from the child auto-approve safelist unless product explicitly accepts delegated durable catalog writes.
