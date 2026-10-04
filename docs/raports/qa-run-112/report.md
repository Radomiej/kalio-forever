# QA112 — Existing Codex response and responsive hydration

2026-10-04. Fixed QA http://localhost:5288/, API3316; no reset, prompt, approval or provider mutation. Starting HEAD103a7d0 plus preserved dirty work.

Read-only real browser regression passed: 1 Chromium test, 2.7s test / 3.6s total, exit0. Existing session58mz05cKrZDGG1DPbMKBU shows Codex · gpt-5.6-luna and exact QA84_CODEX_OK after reload at320/390/820/1440px. No Stop agent, no stale Kalio is responding, document width does not exceed viewport. New screenshot report-run parameter prevents overwriting older QA84 evidence. Mobile390 screenshot visually inspected.

Current read-only runtime settings also confirm Devin authenticated/ACP, catalog ready and not stale, one host, Kalio bridge enabled/configured by settings, native filesystem/web/terminal false. These are configuration facts, not new execution proof.

| Acceptance | Status | Boundary |
| --- | --- | --- |
| Existing Codex response survives F5 | PASS QA | Four viewport widths |
| No stale thinking or page overflow | PASS QA | Existing completed canary only |
| New live Codex call, tools and HITL | OPEN | Not exercised in this read-only run |
| Devin remaining native categories | OPEN | No new Devin prompt |

Screenshots: [320](assets/codex-qa-completed-320.png), [390](assets/codex-qa-completed-390.png), [820](assets/codex-qa-completed-820.png), [1440](assets/codex-qa-completed-1440.png).
