# QA111 — Native audit timestamp tie fixed and verified after F5

2026-10-04. Same fixed QA, existing real failed exec turn uxcZ4DTu4jXXoz1nUKpok. Read-only browser inspection: no new prompt, exec, confirmation or reset. Frontend rebuilt and runtime config restored to authoritative API3316; backend/preview not restarted.

Fail-first unit regressions reproduced wrong running/approved for activity-only and approved calls with equal timestamps. Projection now uses correlated known status observations, ignores metadata-only updates for status selection, and preserves terminal state at equal timestamps. Contradictory failed/completed at the same instant remains unknown rather than inventing order from ids. It still keeps policy declines blocked regardless of contradictory activity.

Focused FE projection/panel12/12 PASS (1.86seconds), typecheck PASS before final test-only addition, Vite build PASS6.97seconds with existing chunk warning, focused ESLint exit0. Chromium1280x720 read-only live test PASS3.0seconds (test2.1): exact turn-scoped audit response, Ran node/Native Devin/failed/call id visible before and after F5, no Stop. Screenshot inspected. No claim of OS-wide CMD census or all native categories.

| Acceptance | Status | Evidence / remaining |
| --- | --- | --- |
| Native exec negative outcome | PASS scoped | QA110 actual failed permission-related result; not raw process output |
| Equal timestamps both UI paths | PASS local | Two regressions plus conflict test |
| Existing real exec failed visible/F5 | PASS QA | Exact call/turn UI response; no rerun |
| QA/HomeSite available | PASS |5288/3316health/57868 HTTP200 |
| All native categories and ChatGPT | OPEN | Write/web/toggle tests and ChatGPT remaining |

Screenshots: [visible failed](assets/native-failure-visible.png), [after F5](assets/native-failure-after-f5.png). Earlier missing failure screenshot is explicitly documented in QA110.
