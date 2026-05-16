# Xiaomi context reasoning fix

## What was done

- Added regression tests proving three failures:
  - assistant `thinking` was dropped when loading history for the LLM,
  - context compaction did not count assistant reasoning content,
  - Xiaomi payloads did not send `reasoning_content` back on assistant tool-call messages.
- Preserved persisted assistant `thinking` as backend-only `reasoningContent` on LLM history messages in `SessionManagerService`.
- Updated `compactLLMHistory` token estimation and truncation to include `reasoningContent`, so reasoning now goes through the same context-management path as regular content.
- Updated `BaseOpenAICompatibleProvider` request serialization to strip backend-only fields from outbound payloads and selectively emit `reasoning_content` only for providers that opt in.
- Enabled reasoning-history replay for `XiaomiMiMoProvider` via provider override.

## Files touched

- `apps/kalio-api/src/modules/chat/session-manager.service.ts`
- `apps/kalio-api/src/modules/chat/llm-history.utils.ts`
- `apps/kalio-api/src/modules/llm/providers/base-openai-compatible.provider.ts`
- `apps/kalio-api/src/modules/llm/providers/xiaomimimo.provider.ts`
- `apps/kalio-api/src/modules/chat/__tests__/session-manager.service.spec.ts`
- `apps/kalio-api/src/modules/chat/__tests__/chat.service.spec.ts`
- `apps/kalio-api/src/modules/llm/providers/base-openai-compatible.provider.spec.ts`

## Decisions

- Did not change `@kalio/types`; `reasoningContent` stays backend-only because it is internal request-shaping state, not a shared BE↔FE contract.
- Routed reasoning through the existing history compaction path instead of adding a provider-only bypass, so context counting stays centralized.
- Limited outbound `reasoning_content` serialization to providers that explicitly opt in, preventing hidden-field leakage to other OpenAI-compatible providers.

## Open questions

- The browser log also showed `HERO_IMAGE_URL_TOKEN` 400s from VFS preview. That appears separate from the Xiaomi provider failure and was not changed in this task.
- If DeepSeek later needs the same reasoning-history replay behavior, it can opt in through the same provider hook.

## Verification

- `pnpm --filter kalio-api exec vitest run src/modules/chat/__tests__/session-manager.service.spec.ts src/modules/chat/__tests__/chat.service.spec.ts src/modules/llm/providers/base-openai-compatible.provider.spec.ts`
- VS Code diagnostics on all touched source and test files: no errors.