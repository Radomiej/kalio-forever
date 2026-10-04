# QA240 — current fixed-QA creator breakpoint proof

2026-10-04. Fixed QA localhost:5288. qa-launch-breakpoint-draft.spec.ts: 1 PASS, 2.6s. No prompt sent, no live LLM call, no session deleted.

Added explicit KALIO_LAUNCH_PRESERVE_DRAFT=1 test mode; existing safety checks still verify empty messages, no active run and no children. Owned draft MhGOPN0zsAgY-HLPDABlN remains in QA (New Chat, Default, selected Devin CLI swe-2). Only one session was created; draft text is unsent frontend state, not promised durable after F5.

Verified widths 1440, 1024, 1023, 820, 390, 320. Desktop displays persona/model/prompt together with no Next/Back. Compact displays configuration then prompt; Back/Next and breakpoint changes preserve model and draft; no horizontal overflow. Model dropdown selects exact swe-2 and displays the existing conditional Pro+ promotional free-price note. Account eligibility/pricing itself was not reverified in this UI test.

Six screenshots assets/launch-{width}.png. 1440 and 390 captures visually inspected. This closes current rendered breakpoint/model/draft parity for this scenario, not project/persona changes, F5 draft persistence, complete keyboard/touch/zoom or actual new-chat execution. Earlier live Devin task evidence remains separate.
