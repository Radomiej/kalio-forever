# QA392 — generated Home Site interactive acceptance

2026-10-04. Existing built preview http://127.0.0.1:57868/, IAB browser. No source edits, live LLM requests, terminal launches, deployment or QA reset.

| AC | Status | Actual browser evidence |
| --- | --- | --- |
| Empty form validation | PASS | Three aria-invalid fields, descriptions blad-imie/blad-email/blad-wiadomosc; focus moved to imie |
| Valid demo result | PASS | Tester QA / qa@example.com / synthetic test message yields status explicitly saying message not actually sent; screenshot form-demo-result.png |
| Retry recovery | PASS | Wypełnij ponownie restores three empty fields, invalid count 0, focus imie |
| Desktop basic layout | PASS at 1280 | One h1, document width 1265 <= viewport 1280; no captured browser error logs |
| Mobile overflow | PASS at 320x800 | document width 305 <= viewport 320; menu toggle visible |
| Menu opening/focus trap | PASS | Open focuses Usługi; Shift+Tab wraps to Bezpłatna wycena; Tab wraps back to Usługi |
| Escape/return focus | PASS | Escape closes menu; active element label Otwórz menu, expanded=false; screenshot mobile-menu-closed.png |

Temporary viewport override reset afterwards. QA and Home Site tabs retained. These are real browser checks of generated output, not device testing or proof of absent form network traffic. Demo messaging was verified, not a network capture. Contrast hover/reduced-motion emulation and full Kalio/Devin/goal-loop acceptance remain separate gates. Overall goal active.
