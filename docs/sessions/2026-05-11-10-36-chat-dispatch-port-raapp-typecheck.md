# 2026-05-11 10:36 - Chat dispatch port and RA-App spec typecheck

## What was done

- Added a dispatch-facing tool registry port so `ChatModule` no longer depends on `ToolRegistryService` directly.
- Rewired `ChatModule` to build `TOOL_REGISTRY` from `TOOL_DISPATCH_REGISTRY`.
- Fixed stale `raapp-create.tools.spec.ts` expectations left over from the old `saveGeneratedApp` path.
- Re-validated the previously extracted tool composition changes together with the new chat wiring.
- Audited the current agent-loop surface for dead code candidates.

## Files touched

- `apps/kalio-api/src/modules/tool/tool-dispatch-registry.port.ts`
- `apps/kalio-api/src/config/tool-application-config.module.ts`
- `apps/kalio-api/src/modules/chat/chat.module.ts`
- `apps/kalio-api/src/modules/chat/chat.module.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-create.tools.spec.ts`

## Decisions made

- Kept `ToolRegistryService` as the implementation behind the new port; the change only hides the class dependency from `ChatModule`.
- Did not remove the agent loop runtime because it is still live in backend orchestration, subagent execution, REST settings, frontend settings UI, and shared socket/type contracts.
- Treated the `raapp-create.tools.spec.ts` failure as drift against the already-shipped versioned-storage implementation, not as a product behavior change.

## Validation

- `apps/kalio-api`: `vitest run src/modules/chat/chat.module.spec.ts src/modules/tool/tool.module.spec.ts src/modules/tool/tools/subagent.tool.spec.ts src/modules/tool/tools/raapp-create.tools.spec.ts` ✅
- `apps/kalio-api`: `tsc --noEmit` ✅

## Agent loop findings

- `ChatService` agent loop is live and still enforces `maxToolAttempts`.
- `SubagentRuntimeService` has its own live loop with `maxIterations`.
- `CredentialsService`, `CredentialsController`, `LLMController`, frontend `LLMPanel`, and shared types still expose the loop limit and MAX_ITERATIONS contract.
- Result: no dead runtime agent-loop code was found to remove safely in this change.

## Next steps

1. If the plan is to replace the agent loop entirely, do it as a coordinated removal/migration across backend runtime, settings API, frontend settings UI, and shared contracts.
2. If you want to shrink old surface before that migration, target duplicate tests first, not live runtime paths.