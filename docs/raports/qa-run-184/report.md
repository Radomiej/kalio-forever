# QA184 — commit-reviewed turn-scoped audit contract

2026-10-04. Fixed QA http://localhost:5288/, API http://127.0.0.1:3316/api, AppData kalio-forever-qa. Existing QA175 frontend/QA167 backend unchanged; no reset, deployment, provider change or live agent prompt. Checkout C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, branch codex/kalio-provider-runtime-ux, pre-review HEAD 85433dee plus preserved mixed dirty work.

Reviewed the existing uncommitted audit slice only: audit-log.controller.ts forwards optional turnId; audit.service.support.ts applies parameterized JSON-validity-guarded turn filter to both hot/archive queries; controller regression covers session/turn isolation across those stores. Added negative missing-turn and filter-before-limit tests. No shared runtime contract/schema change or unrelated HITL source staged.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Hot/archive session/turn isolation | PASS | Controller SQLite tests include other session with same turn and same session with other turn | Native UI panel remains separately scoped |
| Empty evidence does not fall back | PASS | Missing-turn regression; live QA raw JSON [] | Absence of scoped records is not proof of no native tools |
| Filter precedes limit | PASS | Matching record survives newer unrelated row with limit 1 | Large-data performance not measured |
| Current QA endpoint | PASS | Existing real QA181 turn OzSjtuCsZ7ZITyzYOVqvH returns 17 runtime events, all exact session/turn | API-only proof, not rendered UI |
| API typecheck | PASS outside sandbox | System Node tsc --noEmit exit 0 | Initial sandbox check invalid as current-build evidence |
| Browser/screenshot | N/A | No UI change or UI acceptance claim in this slice | Prior UI screenshots retained in QA183 |

Focused Vitest audit-log.controller.spec.ts: 25 passed, 1 file. The invocation also named two nonexistent spec paths, which Vitest did not run; no three-file suite claim. Initial sandbox typecheck produced broad dependency/type errors; rerun outside sandbox with system Node passed. Initial PowerShell API assertion misread an enumerated empty JSON array; corrected raw response and ConvertFrom-Json -NoEnumerate established []. Neither diagnostic artifact was treated as an application bug.

This commits the backend audit dependency used by on-demand per-turn native provenance. Full source ownership/release closure, native-tool UI scope and the overall requested goal remain open. No new release or production claim.
