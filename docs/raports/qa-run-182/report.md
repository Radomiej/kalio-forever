# QA182 — read-only replay, audit correlation harness failure

2026-10-04, same stack/session/project/browser as QA181. No new prompt or LLM execution. Structured error and successful package.json result passed. Test then failed because tool_call audit entries have callId but no data.turnId; assuming turnId on every audit type was incorrect.

Focused GET inspected the two actual tool_call records, both fs_read and both approved project paths. Screenshot assets/assertion-failure.png preserved before rerun. Result: 1 failed (1.5s). Test corrected to correlate durable turn tool-result IDs with audit callId, not current session/persona metadata. No application source changed. QA183 is the next read-only replay of the same real turn.
