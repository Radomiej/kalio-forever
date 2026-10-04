# QA211 — exact Devin build chat/graph parity

2026-10-04. Fixed QA localhost:5288 / 127.0.0.1:3316. Chromium 1440x1000. Read-only existing Devin swe-2 session W4fggLSunrJB41C24MV7C, exact historical QA198 build turn fjbU2ujmlXTkH1Yif5u65. No new prompt, LLM request, tool command, reset or provider mutation.

Browser regression `qa-graph-group-details-readonly.spec.ts --grep 'exact saved Devin'`: 1 PASS, 3.4s, exit 0.

| AC / PIT | Status | Evidence | Remaining |
|---|---|---|---|
| Saved chat tools / PIT-07 | PASS | Exact QA198 final heading; two Kalio-origin cards, terminal_spawn and terminal_output | Active streaming/approval not exercised |
| Grouped graph tools / PIT-02 | PASS | Exact opaque turn-linked group; home-site cwd; terminal id lCbRWGFdb-0GoyWSNKDVy | Zoom grouping behavior unchanged |
| Graph result / PIT-18 | PASS | Persisted terminal_output exitCode 0 and 26 modules exposed in ordinary disclosure | Native audit is a separate consumer |
| F5 / PIT-03 | PASS | Same exact group/arguments/results after reload, Stop absent | Does not prove restart during approval or Stop drain |

Screenshot assets/devin-group-after-f5.jpg visually inspected. Served frontend remains the QA210 build containing other dirty source changes; not a clean-tree release claim. This closes saved build detail parity for this actual Devin turn, not every graph/chat state. No live Devin run was repeated and no cost/free eligibility claim follows from this read-only test.

[P2] Screenshot shows `Runtime audit limit reached; older models may be unavailable.` Graph model identity currently uses at most 2000 session runtime audit entries (useExecutionGraphTurnModels). Exact QA198 tool evidence passed, but historical model completeness is not proven. Prefer scoped/paginated typed runtime identity rather than merely increasing the broad audit limit; inspect endpoint capabilities and regression coverage first.
