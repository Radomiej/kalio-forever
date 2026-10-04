# QA186 — explicit Devin-only native audit scope

2026-10-04. Fixed QA UI http://localhost:5288/, API :3316, AppData kalio-forever-qa. Checkout C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, branch codex/kalio-provider-runtime-ux, pre-edit HEAD 62f1b3a4 plus preserved mixed dirty work. Existing backend QA167 unchanged; rebuilt frontend main index-D-HWRbLa.js served by existing preview. runtime-config.js restored to :3316 after build. No reset, provider mutation, agent prompt, target-project write or terminal spawn.

Confirmed the panel's projector handles Devin ACP native events only. Renamed its disclosure to Devin native tool audit and explicitly stated that other providers' native tools are not reported. Kept the on-demand scoped endpoint and warnings that approval is not execution and missing correlated evidence is not absence of execution. Did not hide historical audit using mutable session/persona/provider settings or the count of Kalio tools. Updated three existing E2E control selectors; those E2E flows were not rerun in this attempt.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Honest provider scope | PASS | New regression RED before rename; current browser shows explicit disclaimer | Actual Codex native projection not implemented by this panel |
| On-demand/errors/refresh | PASS locally | Existing panel tests retain no eager request, failure vs empty, stale status cleared on failed refresh | Concurrent navigation race separately scoped |
| Native statuses projection | PASS locally | Panel/model 13 tests passed | Fresh native execution/denial not performed |
| Frontend gates | PASS | Typecheck exit0 and Vite build 3117 modules | Existing large bundle warning |
| Scope and F5 on fixed QA | PASS | 1 Playwright passed (2.7s), exact existing QA181 turn scoped response checked twice | Empty scoped snapshot is not proof of no native tools |

Initial typecheck caught unsupported Testing Library exact option in the new test; removed it, rerun passed. No app rollback required. Screenshot assets/devin-audit-scope.png saved and visually inspected. Chromium 1280x720; existing real swe-2 session W4fggLSunrJB41C24MV7C, turn OzSjtuCsZ7ZITyzYOVqvH. Read-only proof, no additional Devin run. Backend audit dependency committed in QA184.

This is a truthful labeling/provenance slice, not full multi-provider native tool visibility or release completion. Remaining mixed runtime source and original goal stay open.
