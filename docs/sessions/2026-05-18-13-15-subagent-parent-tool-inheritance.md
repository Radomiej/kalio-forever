# Subagent parent tool inheritance fix

## What was done

- Added regression tests in `apps/kalio-api/src/modules/tool/tools/subagent.tool.spec.ts` for two gaps:
  - when `personaId` is omitted, `run_subagent` should inherit the parent turn's visible toolset instead of resolving the empty `default` persona toolset;
  - when continuing an existing child session without `personaId`, the tool should not force `personaId: 'default'` into the runtime request.
- Updated `apps/kalio-api/src/modules/tool/tools/subagent.tool.ts` so that:
  - explicit `personaId` still resolves persona-scoped tools exactly as before;
  - omitted `personaId` now uses `request.availableTools` from the parent turn;
  - omitted `personaId` is passed through as `undefined`, so the runtime is no longer forced onto `default` persona semantics.

## Why

- Manual QA showed direct `run_cli_agent` worked, simple `run_subagent` worked, but nested `run_subagent -> run_cli_agent` failed.
- Root cause: `SubagentTool` defaulted child requests to persona `default`, and `default` has `allowedTools: []`, so the child had no real `run_cli_agent` tool to dispatch even though the parent did.

## Validation

- Ran: `cd apps/kalio-api; npx vitest run src/modules/tool/tools/subagent.tool.spec.ts`
- Result: 20 tests passed.
- `get_errors` on the touched files returned no errors.

## Open questions

- Child sessions still persist as persona `default` when no explicit `personaId` is supplied. The functional tool gap is fixed, but UI/persona semantics may still diverge from the parent persona label.
- Frontend rendering should still be hardened separately so raw XML-like assistant output cannot trigger React unknown-tag console errors if a model emits malformed markup again.

## Files touched

- `apps/kalio-api/src/modules/tool/tools/subagent.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/subagent.tool.spec.ts`
- `docs/sessions/2026-05-18-13-15-subagent-parent-tool-inheritance.md`
