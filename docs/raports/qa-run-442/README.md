# QA 442 — distinguish interrupted turn descriptions

2026-10-05 Europe/Warsaw. Fixed QA :5288, current worktree frontend build; backend/provider database unchanged, no new Devin request.

Root cause: withRecordedTurnModels replaced descriptions of every completed error-status turn with Turn ended with errors, including intentional Stop. Chat uses turn.error.code INTERRUPTED. Added parameterized regression for INTERRUPTED and CANCELLED and retained the genuine TOOL_ERROR case. Both regressions witnessed RED before their respective condition fixes; final six tests PASS. Earlier typecheck PASS; final pnpm --filter kalio-web build exit 0, including tsc, 3120 modules, Vite 6.4.2. Existing bundle-size warning remains.

Minimal change only distinguishes descriptions. No shared contract or lifecycle model changed. Generic error node status/color and tool-group cancellation mapping remain unresolved; do not call the full parity issue closed.

Served HTML and browser script both reference /assets/index-Bdr5FC5C.js, matching local dist/index.html. Port owner remains PID 59424. After reload and completed history hydration, rendered aria-labels contain three Node detail: Turn interrupted descriptions, one Turn ended with errors, and completed turn descriptions. Earlier immediate getByText count zero was premature, not proof the served fix failed. Verify settled hydration rather than adding fixed sleeps or changing correct conditions from an early snapshot.

| AC | Status | Evidence / remaining |
| --- | --- | --- |
| GRAPH-STOP-LABEL | PASS | RED then 6/6 GREEN, built artifact and rendered interrupted descriptions after F5 |
| GRAPH-REAL-ERROR | PASS for regression and observed existing error | TOOL_ERROR test keeps errors; existing error description remains |
| GRAPH-STOP-STATUS | UNVERIFIED / incomplete | Error color/status and tool-group mapping unchanged |
| QA-PRESERVE | PASS for no reset | Frontend-only rebuild; backend and credentials not modified |

Screenshot assets/01-interrupted-graph.png captures the graph view, then Chat restored. No console-flash attribution, real Jev loop or broader release proof claimed. Pre-existing dirty graph/helper/UI files preserved; owned edits are executionGraphTurnModels.ts and executionGraphTurnModels.test.ts only.

Follow-up regression: executionGraphTurnModels, executionGraphModel.helpers, executionGraphNodePresentation and ExecutionGraphView: four files, 71/71 tests PASS, exit 0. This suite exercised current dirty worktree dependencies without staging them; it is not proof of the isolated committed revision with those foreign changes absent.
