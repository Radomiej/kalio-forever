# QA178 — latest real build retained in Execution Graph after F5

2026-10-04. Same fixed QA, real session and read-only browser scope as QA177. devin-graph-model-live.spec.ts strengthened with opt-in KALIO_DEVIN_GRAPH_EXPECT_BUILD=1: the existing QA172_BUILD prompt card must occur exactly once in the rendered graph after F5 at 390 and 1440px. Report parameter numeric validation avoids overwriting QA89 proof. No new LLM/command execution.

Result: 1 passed (3.3s), test 2.6s. Graph visible, exact recorded swe-2 model present and swe-2-medium absent; latest approved build prompt exactly once, Stop absent. Two screenshots saved in assets/recorded-model-{width}.png. Screenshots capture initial viewport, not necessarily the latest build card's position; DOM assertion proves its presence, not viewport focus.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Recorded model after F5 | PASS | Exact SWE-2 label at both widths | Other providers separately scoped |
| Latest real build retained | PASS | One QA172_BUILD prompt card after F5 | Inspector/tool-count/status reconciliation not asserted |
| Idle state | PASS | No Stop | Active graph streaming not tested |

QA172 remains the authoritative execution/exitCode proof. This run extends consumer evidence to graph presence but does not claim full graph/chat/Canvas parity, native provenance or production readiness. Full goal remains active.
