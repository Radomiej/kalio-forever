# QA104 — Deployed native-policy patch and activity-only audit

2026-10-04. HEAD61a2c91 plus preserved dirty changes and QA103 patch. Fixed QA localhost:5288/API3316 restarted on the same C:/Users/Radomiej/AppData/Local/kalio-forever-qa/kalio-qa.db. Exact old owned PIDs19328/41680 and launcher43028 were verified; canonical stop completed and old launcher exited before replacement. New launcher45452, backend44428/frontend54252. No database deletion or provider credential reset.

Before/after19 execution profiles had identical SHA256 DF8DD360EF8A6B12FAA2EDBA7E6913D5F8110A4331E45A26BDCE79065D11714B using the same compressed JSON serialization. This checks profiles, not an independent full secret inventory. Fresh16-condition Devin preflight passed. Real swe-2 session W4fggLSunrJB41C24MV7C resumed external sincere-limit.

One native Read attempt, exact turn8SBdgVD9befum7dY3dpcS, call a7c3048d-776d-4505-a061-8f6925096d1b, epoch I0ieZ8NkPvwwfIfn2l9Rn, ended toolStatus=failed rather than QA102's completed. Nine audit rows include final llm.turn.completed. Zero native_approval and empty assistant content. The original opt-in callback-only test remains FAIL; hard CLI denial need not emit that callback. Failed status is real evidence of changed behavior, but raw denial reason/output was not captured, so full policy-enforcement acceptance remains UNVERIFIED.

The UI projection previously omitted activity-only calls. Fail-first model test reproduced an empty list; the fix now correlates native activity by session/turn/epoch/call and displays observed failed/completed/running status without inventing approval or policy cause. MCP wrappers are excluded. Focused FE tests9/9 PASS; FE typecheck exit0 and Vite build PASS (existing large-chunk warning). Runtime config restored to authoritative API3316 after build. One initial test command used unsupported Vitest4 minWorkers and ran no tests; corrected command used maxWorkers1.

Read-only browser proof on the existing failed turn: PASS2.9seconds (test2.1), exact scoped audit response, Read file/Native Devin/failed/call id visible before and after F5, no Stop. Screenshot inspected. No new prompt in this visibility check.

| Acceptance | Status | Remaining |
| --- | --- | --- |
| Same target native read no longer completes | PASS observed failure | Capture actual denial reason; do not infer success from status alone |
| Native activity-only visibility/F5 | PASS | Unknown native tool inventory separate |
| Provider profiles retained | PASS | No encrypted export/full-secret inventory claim |
| Complete native-category enforcement | UNVERIFIED | Write matcher, enabled ask, grant/toggle transitions and denial reason |
| Kalio positive path | Subsequent QA105 | Separate gate |

Screenshots: [actual failed-turn result](assets/native-read-result.png), [native failure visible](assets/native-failure-visible.png), [after F5](assets/native-failure-after-f5.png). Existing old QA102 prose visible above the new result is historical, not a claim about the current build.
