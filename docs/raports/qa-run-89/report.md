# QA89 — execution graph runtime identity regression

## Scope and current evidence

Follow-up to QA88: the real SWE-2 HomeSite conversation graph displays the persona recommendation `swe-2-medium`, while the selected execution profile and actual ACP audit show `swe-2`.

The current graph helper sets `modelLabel = persona?.model`. `AgentTurn` and `AgentRunContext` carry no actual model identity. The chat header receives its model separately, so its correct label does not prove graph correctness. A current profile lookup alone also does not establish the model of older turns after configuration changes.

## Acceptance matrix

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| AC-01 / PIT-34 reproduce incorrect provenance | PASS | Focused Vitest: 21 passed, new regression failed because the graph returns `swe-2-medium` despite an explicit session execution profile | Fix actual runtime identity propagation |
| AC-02 parent-turn runtime label is accurate | PASS | Real QA graph now displays audited swe-2, not persona swe-2-medium | Delegated child provenance remains separate and open |
| AC-03 history/F5 identity | PASS | Real persisted conversation survives F5 at 390/1440 with audited model | Older truncated/missing evidence is marked unavailable |
| AC-04 QA deployment | PASS | Frontend build served by fixed QA, correct API/Socket.IO port 3316 | No backend restart or DB reset required |

Command: system Node, web workspace, `node node_modules/vitest/vitest.mjs run src/features/chat/graph/executionGraphModel.helpers.test.ts`; exit 1, 22 tests, 1 intentional RED regression. No live model call, provider change, HomeSite mutation or credential export was performed.

P2: model provenance in the execution graph must be corrected or explicitly accepted before production. This slice is diagnostic progress, not a completed fix. QA88 screenshots remain the before evidence; no new screenshot is claimed here.

## Implementation progress

Real scoped API evidence now confirms that turn `QtdPCGywtpFIkQl_a6iEk` persisted `model: swe-2` in `llm.turn.started` and the corresponding ACP start event. No profile lookup or persona inference is needed to recover this historical model.

Added a pure audit selector scoped by both session and turn, accepting only `runtime_event / llm.turn.started`. It rejects malformed/unrelated evidence, deduplicates repeated iterations and preserves distinct model transitions in timestamp order. Turn identity now accepts this recorded model and does not fabricate a persona model for explicitly selected runtime profiles when evidence is absent.

RED was observed for the existing provenance defect and for the new selector's missing behavior. Focused GREEN: 26 tests passed in two files. This is not yet a complete UI fix: audit loading and wiring into graph rendering, affected gates and real QA/F5 proof remain required. No QA deployment or new live model invocation occurred in this follow-up.

## Subsequent QA deployment and browser proof

Audit loading and turn-node projection are now wired into the real graph. The snapshot is cleared immediately when switching sessions, requests are bounded to the selected session and refreshed by turn lifecycle changes rather than polling or starting CLI processes. Failed or missing evidence does not fall back to a persona recommendation. Errors and truncation are surfaced. Existing viewport controls were extracted to keep the touched view at the repository's 500-line limit.

- Component, selector and loading tests: 59 passed, including rendered actual model and session/error boundaries.
- Entire frontend: 210 test files, 1835 tests passed.
- Full root `pnpm test`: exit 0; API 2906 passed / 3 skipped, frontend 1835 passed, launcher 14 passed.
- Frontend typecheck and build: exit 0. Build warns about a large existing bundle; lint has zero errors and three hydration-effect dependency warnings.
- Frontend published to the already running fixed QA preview; canonical API/Socket.IO origins restored to port 3316. No backend restart, data reset, provider change or new Devin prompt.
- Real browser read-only QA test: 1 passed (3.2 seconds). Existing Devin conversation graph shows `Devin SWE-2 QA - swe-2` after F5 at 390/1440, with no `swe-2-medium` label or Stop control.
- [Mobile screenshot](assets/recorded-model-390.png), [desktop screenshot](assets/recorded-model-1440.png).

This closes actual parent-turn model labeling for the tested conversation. Child/delegated node model provenance, the bounded audit truncation boundary, and the broader Devin/ChatGPT acceptance goal remain open. This is not production acceptance or a global CMD-spam proof.
