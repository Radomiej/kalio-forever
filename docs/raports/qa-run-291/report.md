# QA291 — sequential routing and reload projection pass

2026-10-04, Europe/Warsaw. Isolated built Chromium stack API63854; one worker; deterministic mock, not live Devin/Jev. No production source edits or QA restart.

Prepared an existing conversation with explicit isolated mock execution profile and durable initial response through the repository helper. Assertions now target the workflow envelope rather than unrelated seed turns. No assertion of routing, completion or reload was removed.

Command from apps/e2e: system Node outside sandbox, skip-build after QA289 fresh backend build; `node scripts/run-playwright-with-stack.mjs architecture-chat-subagent-turn.spec.ts --grep 'renders a sequential router chain' --project=chromium --workers=1 --reporter=line`.

Terminal exit0; one test passed5.7s. Workflow1yfGbpzgmFuGWlS-sqT8a, hostuP4ngEnue6f6NDDrGiUYn. Proved completed backend run/graph, three routers and two roles, completed artifact, six sequential canvas steps, no parallel-stage projection, same routing and workflow envelope afterF5.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Sequential fixture | PASS | Explicit isolated mock profile and existing-chat seed | Other old fixtures still need independent checks |
| Runtime sequence | PASS | Completed run/graph, exact three-router/two-role projection and six canvas steps | Real agent output quality not tested |
| F5 projection | PASS | Same envelope/routing after reload | Entire workflow gate not run |
| Screenshot | UNVERIFIED | This passing test does not capture a screenshot | QA290 failure artifacts preserved; no invented green screenshot |

Verdict: sequential mocked workflow slice PASS; full original objective remains active.
