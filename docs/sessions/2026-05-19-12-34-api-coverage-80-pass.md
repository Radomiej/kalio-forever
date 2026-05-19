# API coverage to 80

## What was done
- Added focused backend specs for uncovered runtime files and thin delegation surfaces.
- Expanded Telegram relay coverage to execute public methods and command callbacks.
- Excluded type-only contracts and declaration files from V8 coverage so the report tracks executable runtime code only.

## Files touched
- apps/kalio-api/src/adapters/socket-io.adapter.spec.ts
- apps/kalio-api/src/app.module.spec.ts
- apps/kalio-api/src/modules/mcp/mcp-watchdog.service.spec.ts
- apps/kalio-api/src/modules/mcp/mcp.controller.spec.ts
- apps/kalio-api/src/modules/relay/telegram/telegram-relay.service.spec.ts
- apps/kalio-api/vitest.config.ts

## Decisions
- Optimized for the failing global threshold first: function coverage was the last blocker after statements and lines crossed 80.
- Treated interface-only, DTO-only, type-only, and `.d.ts` files as non-executable coverage noise instead of writing artificial tests for them.
- Left unrelated dirty-worktree files outside `apps/kalio-api` untouched.

## Verification
- `pnpm vitest run src/modules/relay/telegram/telegram-relay.service.spec.ts`
- `pnpm vitest run src/app.module.spec.ts src/modules/mcp/mcp-watchdog.service.spec.ts`
- `pnpm vitest run src/modules/mcp/mcp.controller.spec.ts`
- `pnpm test:cov`

## Result
- Full API coverage passed with: statements `81.06%`, branches `78.69%`, functions `80.71%`, lines `81.06%`.
- `coverage-final.json` contained no files with `0` covered statements after the type-only exclusions.

## Open questions
- Several executable runtime files still have low coverage and would be the next targets if the threshold moves above 81%.

## Next steps
- If coverage is raised again, target `src/modules/cli-agent/**` and `src/modules/raapp/native/systems/**` first.