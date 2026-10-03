# QA96 — Rebuilt HomeSite mobile-menu regression green

2026-10-03. Real built HomeSite http://127.0.0.1:57868/, explicit expected script index-BWlm4q-R.js from the approved real Devin build QA95. No source changes, LLM prompts or extra terminal commands during this audit. Fixed Kalio QA remains localhost:5288.

System Node outside sandbox, external-server Playwright tests/home-site-live-audit.spec.ts --project=chromium; KALIO_HOME_SITE_REPORT_RUN=96, KALIO_HOME_SITE_EXPECTED_SCRIPT=index-BWlm4q-R.js. Exit0, two tests passed, 5.9seconds. Artifact assertion ensures this is not the old QA94 build.

| AC / PIT | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Pointer close / PIT-10, PIT-37 | PASS | Same native click that failed QA94 now closes mobile menu | Physical touch device not tested |
| Link close | PASS | Usługi link changes hash and closes menu | Other individual links not tested |
| Keyboard recovery | PASS | Focus entry, Shift+Tab wrap, Escape and focus return | Complete WCAG audit not claimed |
| Responsive / PIT-09 | PASS | 320/390/1440, no document overflow, H1 visible | Enlarged text not tested |
| Form recovery | PASS | Invalid fields/focus, demo success, reset | Demo only, no email delivery |
| Reduced motion | PASS | Auto scroll and transition duration at most0.01s | No production claim |
| Hero long word | PASS | Single fragment at320px | Arbitrary replacement copy not tested |
| Full Devin/ChatGPT closure | OPEN | Real Devin read/write/HITL/build/F5 chain now proven | Queue, native denial and broader ChatGPT flow remain |

Screenshots: [320](assets/home-site-320.png), [390](assets/home-site-390.png), [1440](assets/home-site-1440.png); corresponding hero screenshots retained. Hero390 visually inspected. QA94 P2 is fixed in the generated target by Devin, not manually patched by Codex. No QA database reset or provider change.
