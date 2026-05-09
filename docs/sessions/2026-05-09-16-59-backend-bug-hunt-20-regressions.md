# Session Log: Backend Bug Hunt 20 Regressions

## What Was Done

- Confirmed 20 unique backend bug cases as intentionally failing regression tests.
- Focused on tool entry points with raw `request.args` handling and missing validation.
- Validated the batch with a targeted Vitest run.

## Files Touched

- `apps/kalio-api/src/modules/tool/tools/run-cli-agent.tool.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/persona.tools.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/image-view.tool.spec.ts`
- `docs/audit/2026-05-09-backend-bug-hunt-20-cases.md`

## Decisions Made

- Kept the scope backend-only even though broader bug-hunt material exists in the repo.
- Chose failing regression tests instead of fixes because the ask was QA verification and bounty triage.
- Used three small spec files instead of one mega-spec to keep the failure surface tied to owning modules.

## Validation

- Ran:

```powershell
pnpm exec vitest run src/modules/tool/tools/run-cli-agent.tool.spec.ts src/modules/tool/tools/persona.tools.spec.ts src/modules/tool/tools/image-view.tool.spec.ts
```

- Result: 20 failed, 9 passed.

## Open Questions

- Whether `run_cli_agent` invalid `workdir` cases can be upgraded in severity after checking the real `AllowedPathsService` behavior end-to-end.
- Whether persona validation should live in tool layer, service layer, or both.

## Next Steps

- Fix each tool boundary with explicit type and enum validation.
- Keep the tests failing until engineering picks a remediation batch, then flip them green module by module.