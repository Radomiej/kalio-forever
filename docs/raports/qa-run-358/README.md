# QA358 — form negative/recovery tests

2026-10-04, rendered Home Site http://127.0.0.1:57868/ from real Devin QA356 build. Synthetic local demo inputs only; no external delivery.

| AC | Status | Evidence |
| --- | --- | --- |
| Reset returns focus | PASS | Wypełnij ponownie → activeElement imie |
| Empty form errors | PASS | Three messages, aria-invalid on imie/email/wiadomosc; focus imie |
| Invalid email and short message | PASS | Two errors; focus email |
| Correct email clears its error | PASS | Only short-message error remains; focus wiadomosc |
| Corrected values succeed | PASS | Explicit demo/non-delivery role=status |
| Reset clears values/errors | PASS | Three empty values, zero errors, focus imie |

Screenshot short-message.png captured before correcting final field. No source edits in this test. This proves selected validation/recovery paths, not real email delivery, complete WCAG or full Kalio readiness.
