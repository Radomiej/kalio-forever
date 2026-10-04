# QA175 — thinking disclosure semantics and post-deploy history

2026-10-04, same fixed QA and real Devin history scope as QA174. ThinkingBlock now declares type=button, aria-expanded, aria-controls and a stable useId content target; hidden content stays non-visible while collapsed. Existing manual state behavior preserved.

New regression RED before fix: missing aria-expanded. GREEN after fix verifies automatic first opening, explicit collapse remaining closed through additional thinking tokens, no animation after streaming ends, and manual historical reopening. ThinkingBlock + AgentTurnBubble + MessageBubble: 61 passed across 3 files; web typecheck and Vite build passed. Existing React act warning from AgentFlowResumeAction and bundle-size warning remain, not counted as new proven product failures.

Frontend index-DW34-EoM.js deployed through existing Vite preview; regenerated runtime-config restored to API/WS http://127.0.0.1:3316 from managed fixed-stack state. No backend restart, provider/token changes or DB reset. Chromium qa-home-site-chat-live-audit.spec.ts after deployment: 1 passed (3.1s), 320/390/820px screenshots saved. This browser test verifies completed-history/idle behavior, not the new ARIA disclosure in a live reasoning stream; that boundary is unit-proven, full browser/assistive-technology coverage remains open.

| Scope | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Disclosure state and manual collapse | PASS | RED/GREEN regression | Physical screen reader not tested |
| Adjacent bubble regressions/types/build | PASS | 61 tests, tsc, Vite | Full release suite remains |
| Completed real history/F5 compact | PASS | 1 Chromium test, three widths | Live phase transitions separately scoped |

Full goal remains active; no claim of production readiness or complete closure of every prior UX requirement.
