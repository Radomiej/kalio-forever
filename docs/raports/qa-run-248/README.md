# QA248 — mounted thinking-to-answer lifecycle regression

2026-10-04, Europe/Warsaw. Local frontend fixture proof, not a live provider or browser acceptance. Added a sequential rerender regression for the same AgentTurnBubble DOM instance: active reasoning -> streamed answer -> persisted final answer. Retained thinkingChunks deliberately remains populated to reproduce the original stale animation risk.

Assertions: active stage has loading; answer stage keeps exactly one Thinking control with no loading/pulse and displays streamed text; final stage retains the same bubble, renders final text, and has no thinking animation or streaming indicator. This strengthens the prior separate-state tests without timing sleeps or production hooks.

Command: system Node Vitest run AgentTurnBubble.test.tsx, ThinkingBlock.test.tsx, ChatInterface.Parts.test.tsx. **76 PASS / 3 files, 1.62s at 14:38:24**. Includes retained-thinking, approval-wait and postapproval tool hydration coverage. Working checkout still contains previously recorded mixed frontend changes; this result is against that checkout, not the committed baseline alone.

| Acceptance | Status | Remaining |
| --- | --- | --- |
| Mounted reasoning/answer/final DOM transition | PASS fixture | Store and Markdown boundaries are mocked |
| No duplicate Thinking in the tested transition | PASS fixture | Multiple real provider chunks require full-stack proof |
| Live browser active transition | UNVERIFIED | Still required; completed-history/F5 screenshots do not substitute |
| New live frontend deployment | N/A | No production behavior changed in this attempt; current QA frontend remains QA242 |

No screenshots fabricated. No fixed QA data reset, provider mutation or Home Site source edit.
