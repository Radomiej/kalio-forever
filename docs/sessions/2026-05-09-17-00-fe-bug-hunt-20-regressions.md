# FE Bug Hunt: 20 Confirmed Regressions

## What Was Done

- Hunted current frontend bugs in `apps/kalio-web` instead of relying on stale audit findings.
- Added 20 regression tests that currently fail on the present FE implementation.
- Verified the pack with a focused Vitest run limited to the touched regression files.

## Files Touched

- `apps/kalio-web/src/services/compactStrategy.test.ts`
- `apps/kalio-web/src/features/chat/buildHistory.test.ts`
- `apps/kalio-web/src/features/settings/LLMPanel.test.tsx`
- `apps/kalio-web/src/store/agentStore.spec.ts`
- `apps/kalio-web/src/store/sessionStore.spec.ts`
- `apps/kalio-web/src/features/settings/CLIAgentPanel.test.tsx`

## Confirmed Failing Regressions

1. `P2` `compactStrategy`: trims a plain assistant reply before a `tool_result` message.
2. `P2` `compactStrategy`: trims a later user message before available assistant messages.
3. `P3` `compactStrategy`: refuses to compact assistant-only histories over the limit.
4. `P2` `compactStrategy`: leaves orphaned `tool_result` messages instead of removing tool-call/result pairs together.
5. `P1` `buildHistory`: drops image-only user messages from history completely.
6. `P1` `buildHistory`: loses multimodal text+image content and emits plain text only.
7. `P1` `buildHistory`: collapses multiple image attachments instead of preserving all images.
8. `P2` `buildHistory`: ignores `imageDetailMode` for generated image parts.
9. `P3` `LLMPanel`: provider test button becomes enabled for whitespace-only API keys.
10. `P3` `LLMPanel`: create-provider payload persists whitespace-only API keys.
11. `P3` `LLMPanel`: create-provider payload persists whitespace-only base URLs.
12. `P3` `LLMPanel`: create-provider payload persists whitespace-only models.
13. `P3` `LLMPanel`: create-provider payload persists whitespace-only names instead of defaulting to provider label.
14. `P3` `agentStore`: blank `callId` collapses distinct tool activities into one row.
15. `P3` `agentStore`: blank session key is accepted into `pendingConfirmations`.
16. `P4` `agentStore`: blank `callId` is accepted into the persistent `callIdToName` map.
17. `P4` `agentStore`: blank `callId` is accepted into `cliAgentOutput`.
18. `P2` `sessionStore`: chunk events without a target session create ghost assistant state under the empty-string session key.
19. `P3` `CLIAgentPanel`: timeout values below the UI minimum are serialized and saved.
20. `P3` `CLIAgentPanel`: `maxOutputChars` values below the UI minimum are serialized and saved.

## QA Command

Run from `apps/kalio-web`:

```powershell
pnpm exec vitest run src/services/compactStrategy.test.ts src/features/chat/buildHistory.test.ts src/features/settings/LLMPanel.test.tsx src/store/agentStore.spec.ts src/features/settings/CLIAgentPanel.test.tsx src/store/sessionStore.spec.ts
```

Expected result at the time of writing:

- `20 failed`

## Decisions

- Prioritized deterministic unit/component regressions over speculative browser-only issues.
- Kept all changes in tests only; no production code was modified.
- Used existing test harnesses where available to minimize drift and review noise.

## Open Questions

- `buildHistory` currently has a documented multimodal shape but no FE-side implementation for attachments; fix direction should align with backend `SessionManagerService.toLLMMessages()`.
- `compactStrategy` comments promise tiered trimming, but the implementation is currently a simple linear delete loop; product expectations should be confirmed before fixing.

## Next Steps

- Decide whether QA wants payout severity to follow the proposed `P1`–`P4` labels above or a separate rubric.
- Fix the regressions in priority order starting from `buildHistory`, `compactStrategy`, and `sessionStore`.