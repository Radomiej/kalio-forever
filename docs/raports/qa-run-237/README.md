# QA237 — thinking and tool provenance source reconciliation

2026-10-04. Local frontend tests against the current mixed worktree. No QA restart or new provider execution in this attempt.

| Acceptance | Status | Evidence |
| --- | --- | --- |
| Retained thinking stops animating when answer starts / turn completes | PASS locally | AgentTurnBubble regression covers active and completed answer states |
| Actual current thinking still animates | PASS locally | Active thinking regression |
| Pending confirmation represented separately from tool execution | PASS locally | liveTurnState tests |
| Tool provenance, arguments and persisted status | PASS for focused suite | ToolCallBubble test/spec files |
| Focused combined suite | PASS with fixture warnings | 128 tests / 4 files, 1.88s at 14:14:47 |
| Own source fully reviewed and committed | OPEN | Remaining dirty changes span hydration, launch and tool display; do not blanket-stage |
| Complete rendered thinking lifecycle on current QA | UNVERIFIED | Recent completed-response screenshots are not an active-thinking lifecycle proof |

Read known ThinkingBlock and NativeToolAuditPanel dependencies; both already tracked/clean. Native panel is intentionally Devin-only, uses exact session/turn audit correlation, and does not claim approval is execution. Existing full tests emitted React act warnings and handled mocked AgentFlow refresh errors. They were not silently suppressed and require separate fixture cleanup if these tests are used as warning-free release gates.

No new product behavior was added in this attempt. The validation advances ownership/closure reconciliation; it does not close every original UX request, native provider boundary, or all workflow surfaces.
