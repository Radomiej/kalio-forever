# QA171 — actual generated HomeSite responsive and interaction recheck

2026-10-04. Read-only browser audit of http://127.0.0.1:57868/, the preview previously launched by real Devin/Kalio in QA167. Exact served build asserted: index-BWlm4q-R.js; title NEXORA — Nowoczesne rozwiązania IT. Project E:/Projekty/home-site, fictional company React demo. No direct edits, build, terminal command or model execution in this attempt. Fixed Kalio QA remains http://localhost:5288/; this audit proves the generated site, not the Kalio settings UI.

Playwright home-site-live-audit.spec.ts, Chromium: 2 passed (6.5s).

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Responsive 320/390/1440px | PASS | Correct width, no document overflow, visible hero, mobile navigation initially off viewport; six screenshots saved | Physical device and other engines not tested |
| Long hero word at 320px | PASS | oprogramowanie occupies one text fragment, not split mid-word | Other localized content not covered |
| Mobile menu and keyboard | PASS | Open/close toggle, link close, first-link focus, reverse focus wrap, Escape and focus return | Broader WCAG audit not claimed |
| Demo form | PASS | Three invalid fields on empty submit, focus first field, valid synthetic data shows demo completion, reset clears and focuses | No actual message/email delivery: intentionally demo |
| Reduced motion | PASS | Media query applied, scroll behavior auto, menu transitions <= 0.01s | Physical platform settings not tested |

assets/home-site-320.png, home-site-390.png, home-site-1440.png and corresponding hero screenshots saved. All three hero screenshots were visually inspected: no heading/CTA overlap or horizontal clipping observed. Fictional business figures remain demo content, not verified company claims. No new failing behavior reproduced within this audit's assertions; this is not complete application or production proof.
