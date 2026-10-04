# QA251 — reasoning-to-answer proof; final selector failure

2026-10-04. Isolated UI52048/API52049. [Active reasoning](assets/active-thinking.png), [streamed answer](assets/answer-streaming.png), [failure](assets/fixture-final-selector-failure.png).

Active and answer assertions PASS: exactly one Thinking, loading only during reasoning; no duplicate pending bubble; Stop visible while answer still streaming. Answer screenshot visually inspected.

Attempt FAIL at final Stop assertion. Investigation of accessibility snapshot showed the broad Answer finished selector also matched the user prompt, so it advanced before the second deliberate hold ended. Correction scoped final-text assertion to agent-turn-bubble containing the unique result heading. No application behavior changed for this failure. Final/F5 not proven here.

[P2] Active mock turn displayed Devin native tool audit while provider journal was not yet known. After F5 the persisted direct-provider journal hides it. Current legacy unknown-provider fallback causes misleading live provider labeling; follow-up required. Do not use mutable persona/session defaults as the fix. Fixed QA not restarted.
