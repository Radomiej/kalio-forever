# QA252 — full browser thinking/answer/final lifecycle

2026-10-04. Chromium 1280x720, isolated random-port UI54136/API54137, unique runner-generated database under data/playwright-stack (test explicitly rejects any other DATABASE_PATH). Exact generated directory was not retained in this receipt. No fixed QA reset/provider mutation and no live model generation. Controlled MockLLMProvider uses real Nest/Socket.IO/store/render/history boundaries, not synthetic browser events.

regression-thinking-answer-lifecycle.spec.ts: **1 PASS, 15.1s**. One fixture preparation via socket, then test prompt sent from UI. Backend had 36 focused tests PASS, typecheck and build. Frontend existing built artifact from QA242; relevant local component tests QA248 had 76 PASS.

| Acceptance | Status | Evidence |
| --- | --- | --- |
| One active Thinking, no pending duplicate | PASS | One Thinking with loading before answer |
| Thinking animation stops as text arrives | PASS | No loading/pulse; unique heading visible while Stop still visible |
| Terminal lifecycle drains | PASS | Agent bubble contains final text; Stop absent; current run empty |
| F5 retains reasoning/final without activity | PASS | Thinking retained without animation, result heading visible, pending/connection status absent |
| Real Devin reasoning timing | UNVERIFIED | Mock fixture is deliberately deterministic; real Devin generation shown separately QA245/246 |

Screens: [active](assets/active-thinking.png), [answer](assets/answer-streaming.png), [final after F5](assets/final-after-f5.png). Final screenshot visually inspected. Per-phase 6-second holds are diagnostic scheduling only. Owned session removed in finally and runner exited0 with test stack cleanup. Three prior fixture/setup failures are preserved in QA249–251, not silently counted as PASS.

Remaining P2 live unknown-provider audit-label issue from QA251; full root tests and other user-requested integration UX/goal-loop work remain open.
