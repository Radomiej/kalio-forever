# QA481 — completed refusal turn verified in fixed QA

2026-10-06. Fixed QA http://localhost:5288, Chrome normal viewport,
existing real Devin swe-2 session W4fggLSunrJB41C24MV7C.
No new model request, backend/host restart or provider configuration write.

Build passed: tsc and Vite 6.4.2, 3121 modules, 5.19s.
Main served asset confirmed from DOM script src: /assets/index-C5vJpgpo.js.
Existing bundle-size warning remains; no claim it was fixed.

After reload and settled graph hydration, QA479 refusal turn now shows
Status ready / Turn completed; its fs_write still shows Status cancelled.
Final denial response and QA479_RECOVERED remain present. Returning to Chat
shows final heading count one, recovered count one, Stop count zero.

| AC / pitfall | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Completed turn versus cancelled tool | PASS | settled QA graph, same persisted QA479 turn | none for observed case |
| Explicit interrupted/cancelled turns remain distinct | PASS local | cancellation regression suite | no new live Stop run |
| RED to GREEN / PIT-34 | PASS | new recovered-refusal regression failed before fix; 44/44 after | none |
| Types and build | PASS | tsc --noEmit; production frontend build | none |
| F5 and next action / PIT-18 | PASS | graph reload then Chat, no duplicate final or Stop | none |
| Ownership/commit | UNVERIFIED | earlier cancellation changes preserved in dirty files | scoped commit needs dependency review |
| Startup flashing consoles | NOT DONE | not measured in this run | separate unresolved diagnostic |

graph.jpg captures the viewport. Exact latest-turn status was verified in the
accessibility tree; off-screen graph nodes are not proven by screenshot alone.
This closes the observed graph mismatch on QA, not the entire project objective.

## Wider graph regression gate

2026-10-06 14:20 local: pnpm exec vitest run src/features/chat/graph
passed 19 files / 229 tests, duration 4.68s. This covers local graph tests,
including cancellation, architecture roots/runs, tool grouping and runtime
sources. It does not substitute for live Jev or additional provider runs.
