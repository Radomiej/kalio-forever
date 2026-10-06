# QA482 — refusal audit reconciliation

2026-10-06. Read-only scoped QA audit; no model prompt, restart or settings write.
Session W4fggLSunrJB41C24MV7C, refusal turn VKplEkfNEqlcvzr8RLlvC.
Returned 2000 rows span 1791106581942 through 1791288847750, covering this turn.
Both turn filtering and time-window filtering were used because confirmation
denied and dispatcher records do not all carry turnId.

The transport approval is distinct from human approval:
- nsSDjywbqhwXJ3zG171KR: devin-cli-acp.mcp_approval accept, kalio-runtime/fs_write;
- eq6IAinopzzX7faCTpZK3: tool.confirmation.requested;
- request eloVVJBkSNxidojYSEF8x;
- OpT0U67OLexvfbXS82hyu: HITL approval cancelled, source manual;
- yDRmgcJFFcLNtSN_tsvOE: tool.confirmation.denied, cancelled;
- Bb2xDL-4jkd_mSTrwfUMl: dispatcher tool_result cancelled;
- W2ljFcQOn6UBI3dubA8Q2 and Sq3tJ1uytgZCiSa3x0kwF: turn completed.

Kalio call id mcp-18c6d5c1-449f-415c-9291-032fd50d0ae3-6 differs from
provider id 595fae51-3be7-41cd-81a7-d66d47b5d0c7. Correlation uses exact
turn, tool name, request and chronology, not an invented equal identifier.
Bridge event records stdio and native filesystem/web/terminal false.

| Requirement | Status | Boundary |
| --- | --- | --- |
| Manual refusal durable in audit | PASS | manual HITL cancellation plus denied event |
| Transport accept not confused with write authorization | PASS | separate events before waiting and cancellation |
| Dispatcher result agrees with chat | PASS | cancelled, then completed assistant turn |
| Native policy recorded | PASS scoped | configuration event, not universal absence of OS activity |
| File absence independently checked | UNVERIFIED | this run reads audit only |

No screenshots: this run performed API-only inspection, with no browser action.
