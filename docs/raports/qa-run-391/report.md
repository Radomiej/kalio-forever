# QA391 — graph error-label frontend rollout

2026-10-04, fixed QA localhost:5288. Frontend rebuilt in current checkout; existing preview serves dist. API not restarted, no provider or target-project changes.

- Graph regression scope: 17 files, 210/210 tests PASS outside sandbox with system Node.
- Package build equivalent tsc then vite build: exit 0, 3120 modules, main asset index-BojHPTNb.js 2115.93KB. Existing >500KB chunk warning remains.
- Restored generated dist/runtime-config.js to authoritative managed stack API/WS http://127.0.0.1:3316 after build copied the empty public default. This generated artifact is not a source change to commit.
- Reloaded QA in IAB; graph DOM showed two `Node detail: Turn ended with errors` and eight `Node detail: Turn completed`. This corresponds to the observed cancelled/recovered-error historical turns; does not change their status or erase tool errors.
- Returned Chat view: latest QA387_APP_AUDIT_RESULT present, Stop count zero. Screenshot graph-status-labels.png preserves rendered graph.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Error detail after runtime identity hydration | PASS | Fail-first regression QA390, full graph suite and rendered QA labels | Not new lifecycle semantics |
| Successful turn label preserved | PASS | Eight completed labels and successful final response after F5 | Full frontend suite not rerun |
| No API/provider reset | PASS for this slice | Frontend-only build/config refresh | No global readiness claim |

Fix is visible on fixed QA, not production. Startup-window attribution, Jev loop, other queued/drain cases and overall requested goal remain open. Build includes existing unrelated dirty frontend changes; commit scope is limited to owned identity-label files and reports, not a clean whole-revision deployment claim.
