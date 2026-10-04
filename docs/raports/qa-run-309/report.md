# QA309 — Home Site contact workflow

2026-10-04. Actual rendered Home Site at http://127.0.0.1:57868/, fresh build from QA308. In-app browser tab8, normal viewport. No source edits or target commands.

Clicked hero CTA Porozmawiaj z nami: URL became #kontakt. Submitted empty form: three required fields invalid; focus moved to imie. Filled fictitious Tester QA / tester@example.com / QA309 demo message and submitted. Rendered role=status explicitly says this is a demonstration and the message was not actually sent. Saved contact-demo-result.png.

Clicked Wypełnij ponownie: all three fields empty, focus restored to imie. This closes the tested form recovery workflow, not real email delivery. Network transmission absence was not independently instrumented; only the visible demonstration contract was verified.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Hero contact navigation | PASS | #kontakt after real click | Other navigation paths not exercised here |
| Empty form validation | PASS | Required invalid fields and first-field focus | Invalid email case not retested here |
| Honest demo result | PASS | Visible status and screenshot | Production delivery is out of this demo scope |
| Repeat form workflow | PASS | Cleared fields and restored focus | Mobile/keyboard full workflow not retested here |

No new issue reproduced in this narrow workflow. Full Kalio readiness remains unproven: console startup flashes, real goal/Jev loop and remaining lifecycle/release gates are still open.
