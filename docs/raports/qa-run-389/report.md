# QA389 — real Devin turn chat/graph hydration parity

2026-10-04. Fixed QA localhost:5288, existing Home Site Devin SWE-2 session. No prompt, provider reset, target changes or QA deployment.

After browser reload, QA387_APP_AUDIT_RESULT remained in the latest assistant bubble. Stop-agent count was zero. Thinking was a collapsed historical disclosure (`aria-expanded=false`), not an observed active streaming indicator.

Graph visibly reconstructed the QA387 prompt, Devin SWE-2 turn labelled Turn completed, Tools: 2, one `2 calls collapsed: Tool group` with `fs_read, fs_read`, one App.jsx file node and the corresponding final QA387_APP_AUDIT_RESULT response. This matches the two distinct call IDs verified in QA388. Screenshots preserve graph-after-refresh.png and chat-after-refresh.png. Restored Chat view and left QA/Home Site tabs available.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Final reply survives F5 | PASS for QA387 | Latest real assistant bubble after reload | Other lifecycle/queue cases separate |
| No stuck active thinking | PASS for this completed turn | Stop count 0, collapsed Thinking | Historical disclosure intentionally remains |
| Grouped tool trace parity | PASS for QA387 | One two-call group, file and final response | Group inspector details not tested in this slice |

[P2] Historical graph shows cancelled QA383 turn as Status: error alongside detail Turn completed, and recovered QA368 as error alongside completed detail. This conflates execution terminality with successful outcome and deserves explicit state-label review; not changed in foreign-dirty graph files here. Full graph architecture parity and Jev goal loop remain unverified. Overall goal active.
