# Orchestrator Design Preview Validation

## What was done
- Continued live Playwright validation of prototype-capable personas against the VFS-first HTML workflow.
- Confirmed earlier live successes for UX Designer, RaBuilder, and Fullstack Dev.
- Reproduced an Orchestrator failure mode: the child agent completed delegated prototype work, but the parent session could not finish with `design_preview` because `orchestrator.allowedTools` did not include it.
- Added a regression assertion in `apps/kalio-api/src/modules/persona/persona.service.spec.ts` requiring `design_preview` for Orchestrator in the prototype-capable persona set.
- Updated `apps/kalio-api/src/assets/personas.json` to add `design_preview` to the Orchestrator allowlist.
- Ran `pnpm vitest run src/modules/persona/persona.service.spec.ts` once to confirm failure before the fix and again to confirm all 20 tests pass after the fix.
- Synced the running dev API row for `orchestrator` via `PUT /api/personas/orchestrator` because the live DB still had the stale allowlist during this session.

## Files touched
- `apps/kalio-api/src/assets/personas.json`
- `apps/kalio-api/src/modules/persona/persona.service.spec.ts`
- `docs/sessions/2026-05-10-09-15-orchestrator-design-preview-validation.md`

## Decisions
- Did not change `PersonaService.onApplicationBootstrap()` to overwrite `systemPrompt` for existing personas.
- Left the existing `ra-apps` prompt-preservation behavior intact because the test suite already guards against clobbering user customizations on restart.
- Fixed only the concrete missing allowlist entry that matched the observed Orchestrator runtime failure.

## Runtime findings
- Live API after sync shows `orchestrator.allowedTools` now includes `design_preview`.
- The long-running dev terminal showed repeated `Session re-identified` logs during the Playwright runs; this looked like log churn rather than a shell input prompt.
- After repeated browser interactions the frontend drifted out of the chat view into RA-App/API views (`/api/raapp/list` and the app portal). This blocked a clean final browser re-check of Orchestrator and Jony in the same tab.

## Open questions
- Why does the frontend/browser history drift from chat to RA-App/API views during extended prototype validation?
- Are the repeated `Session re-identified` logs expected under subagent-heavy flows, or is there an unnecessary reconnect/reattach loop?

## Next steps
- Re-run one fresh browser sanity check for Orchestrator in a clean chat tab now that the runtime allowlist includes `design_preview`.
- Investigate the chat-to-portal/API navigation drift if it reproduces again.