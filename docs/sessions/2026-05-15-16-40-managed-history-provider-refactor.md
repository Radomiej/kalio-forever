# Managed History Provider Refactor

## What was done

- Centralized LLM history preparation behind `SessionManagerService.loadHistoryForLLM(...)` and `prepareHistoryForLLM(...)` so system prompt, content, tool calls, tool results, attachments, and assistant reasoning all flow through one managed context path.
- Added backend-only `ContextManagedLLMMessage` with `reasoningContent` so persisted assistant `thinking` can be counted and truncated without leaking to providers that do not support reasoning replay.
- Routed both main chat and subagent chat through the same managed-history path.
- Replaced the standalone legacy `OpenAICompatibleProvider` implementation with a thin subclass of `BaseOpenAICompatibleProvider` to remove serializer drift.
- Updated focused tests to cover the centralized history path, subagent delegation, and shared provider serialization/error behavior.
- Updated the current architecture docs so they describe `loadHistoryForLLM(...)` as the shared managed-context boundary and document the shared `BaseOpenAICompatibleProvider` path.

## Files touched

- `apps/kalio-api/src/common/utils/context-managed-llm-message.util.ts`
- `apps/kalio-api/src/modules/chat/llm-history.utils.ts`
- `apps/kalio-api/src/modules/chat/session-manager.service.ts`
- `apps/kalio-api/src/modules/chat/chat.service.ts`
- `apps/kalio-api/src/modules/chat/subagent-runtime.service.ts`
- `apps/kalio-api/src/modules/chat/interfaces/llm-source.interface.ts`
- `apps/kalio-api/src/modules/llm/llm.types.ts`
- `apps/kalio-api/src/modules/llm/llm.service.ts`
- `apps/kalio-api/src/modules/llm/providers/mock.provider.ts`
- `apps/kalio-api/src/modules/llm/providers/base-openai-compatible.provider.ts`
- `apps/kalio-api/src/modules/llm/providers/openai-compatible.provider.ts`
- `apps/kalio-api/src/modules/chat/__tests__/session-manager.service.spec.ts`
- `apps/kalio-api/src/modules/chat/__tests__/chat.service.spec.ts`
- `apps/kalio-api/src/modules/chat/__tests__/subagent-runtime.service.spec.ts`
- `apps/kalio-api/src/modules/llm/providers/openai-compatible.provider.spec.ts`
- `docs/application-architecture-current.md`
- `docs/chat-streaming-tools-architecture.md`

## Decisions

- `reasoningContent` stays backend-only and is never moved into `@kalio/types` because it is part of internal context management, not a BE/FE wire contract.
- Provider-specific request formatting stays in the base provider hook surface; only providers that opt in replay `reasoning_content`.
- Subagent history is not a special case and must obey the same compaction and counting rules as the main chat loop.

## Validation

- `pnpm --filter kalio-api exec vitest run src/modules/chat/__tests__/session-manager.service.spec.ts src/modules/chat/__tests__/chat.service.spec.ts src/modules/chat/__tests__/subagent-runtime.service.spec.ts src/modules/llm/providers/openai-compatible.provider.spec.ts src/modules/llm/providers/base-openai-compatible.provider.spec.ts`
- Result: 5 files passed, 66 tests passed.
- `cd apps/kalio-api; node_modules\.bin\tsc.CMD --noEmit`
- Result: passed with no errors.
- VS Code diagnostics on all touched runtime and test files: no errors.
- `git diff -- docs/application-architecture-current.md docs/chat-streaming-tools-architecture.md`
- Result: diff limited to documenting the centralized managed-history flow and shared OpenAI-compatible provider path.

## Open questions

- This change does not address unrelated provider/runtime issues outside the managed-history surface, including the separate `HERO_IMAGE_URL_TOKEN` 400.

## Next steps

- Run a broader `kalio-api` test or typecheck pass if more provider/runtime work lands on top of this refactor.