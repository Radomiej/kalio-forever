# QA241 — completed real Devin chat mobile hydration

2026-10-04. Read-only fixed QA localhost:5288, existing real Home-site session W4fggLSunrJB41C24MV7C, exact Devin swe-2. No new prompt, session mutation or provider execution.

qa-home-site-chat-live-audit.spec.ts: 1 PASS, 3.0s. At widths 320/390/820 after reload: correct runtime label and usable composer, no Stop agent, no responding placeholder, conversation sidebar hidden, zero active thinking loading/pulse indicators, no document horizontal overflow.

Screens assets/completed-real-chat-{width}.png; 390 capture visually inspected. This is completed-history hydration proof. The test allows zero Thinking controls and therefore does not prove a previously visible thinking section transitioned during a live stream. Active-thinking-to-answer transition remains a separate open acceptance row; local component regressions cover it but are not live browser evidence.
