# QA242 — long response headings no longer clipped

2026-10-04. Fixed QA localhost:5288, frontend-only deployment; backend and Home-site preview were not restarted.

QA241 screenshot exposed a long response heading clipped inside the bubble even though the document had no horizontal overflow. Added overflow-wrap:anywhere to Markdown H1–H4. RED: 4 new heading regressions failed at 14:21:39. GREEN: all 8 Markdown tests passed at 14:22:04. Frontend tsc passed; Vite build 3118 modules / 4.96s, main index-CgCSQDsk.js. Existing large-bundle warning remains. Runtime-config restored to API/ws http://127.0.0.1:3316.

Extended read-only browser audit to measure actual persisted response heading scrollWidth <= clientWidth + 1, requiring at least one heading. 1 PASS, 3.1s; 320/390/820 after F5, no document or internal heading overflow. New screenshots assets/completed-real-chat-{width}.png; 390 visually inspected against QA241. No new prompt or user data mutation.

This fixes observed heading clipping and preserves completed-history hydration. Active thinking transition, every Markdown element/level in a live browser, and full product acceptance remain separate; local H1–H4 regressions cover the shared renderer contract.
