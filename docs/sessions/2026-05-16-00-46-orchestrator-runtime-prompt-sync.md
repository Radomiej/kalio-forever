# 2026-05-16 00:46 — orchestrator runtime prompt sync

## What was done
- Rejected the temporary bootstrap-based `orchestrator` prompt refresh heuristic after user feedback.
- Reverted the temporary `PersonaService` bootstrap change and its paired regression test.
- Strengthened the seeded `orchestrator` persona prompt in `apps/kalio-api/src/assets/personas.json` so pure DSL RA-App delegations explicitly forbid preview-oriented outputs (`preview links`, `rendered previews`, `design_preview results`) and ask for draft/app IDs, executed DSL commands, and test/publish status instead.
- Extended the existing persona regression in `apps/kalio-api/src/modules/persona/persona.service.spec.ts` to lock that stronger prompt wording.
- Applied a one-off runtime data correction by overwriting the live `orchestrator` persona through `PUT /api/personas/orchestrator` using the current seed from `personas.json`.

## Files touched
- `apps/kalio-api/src/assets/personas.json`
- `apps/kalio-api/src/modules/persona/persona.service.spec.ts`

## Validation
- `pnpm --filter kalio-api exec vitest run src/modules/persona/persona.service.spec.ts -t "teaches the orchestrator to keep RA-App DSL delegation on the draft-first path instead of HTML preview flow"` ✅
- `pnpm --filter kalio-api exec vitest run src/modules/persona/persona.service.spec.ts` ✅ (27 passed)
- `GET /api/personas/orchestrator` after direct `PUT` confirmed the live prompt contains the stronger preview-ban wording.
- Live browser check on a fresh Orchestrator chat showed the newest child delegation prompt no longer requested `design_preview`; an older leaked prompt was still visible from a previous session created before the runtime overwrite.

## Decisions
- Do not keep seed drift repair logic inside `onApplicationBootstrap()` for `orchestrator`; that would risk clobbering legitimate user customizations.
- Treat this as two separate concerns:
  1. repo seed quality (`personas.json` + test)
  2. one-off runtime data correction for already-persisted seeded personas

## Open questions
- If seeded personas are meant to be user-editable long-term, the project still lacks a formal migration/sync mechanism for seed updates beyond one-off API/DB corrections.
- If seeded personas are meant to be system-owned, the repo may eventually need an explicit immutable/system persona concept instead of heuristics.

## Next steps
- If needed, add an admin-only reseed/sync command for selected seeded personas instead of relying on bootstrap heuristics.
- If the same stale-seed issue appears in other environments, apply the same one-off `PUT /api/personas/<id>` correction or reseed from DB/admin tooling.
