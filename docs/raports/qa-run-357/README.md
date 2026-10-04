# QA357 — real preview and resize/form regression

2026-10-04 fixed QA5288/API3316. Real Devin swe-2 requested approved npm preview on loopback57868, exact Home Site cwd; Confirm clicked once. UI reports terminal J2JwQ8FmJBR0PeAtJGmfk running. Preview HTTP200 and rendered page verified.

Actual viewport640: open mobile menu, Tab from last nav link wraps to Usługi. Resize641: Tab from last link goes to Porozmawiaj z nami outside header nav; toggle aria-expanded false. The original desktop keyboard trap no longer reproduces in this test.

Actual390: native Escape then Tab immediately after opening focuses Porozmawiaj z nami, outside nav; closed nav display none. Form filled with synthetic QA Test/qa@example.com/demo message. Submit displays role=status explaining no actual message was sent and Wypełnij ponownie. Normal email accepted; cancelled malformed regex was not applied. Viewport reset after test. Screenshot form-demo.png.

| AC | Status | Remaining |
| --- | --- | --- |
| Real agent starts existing built preview | PASS | UI terminal running + HTTP/render |
| Mobile640 keyboard wrap | PASS | Observed focus Usługi |
| Resize641 releases desktop keyboard | PASS | Focus outside nav, open false |
| Rapid Escape/Tab390 | PASS | Closed nav excluded |
| Valid demo form submit | PASS | Explicit non-delivery status |
| Full accessibility/reduced-motion/invalid-input suite | UNVERIFIED | Not covered by this slice |
| Backend-loss approval resume | UNVERIFIED | Separate controlled test required |
| OS console flash absence | UNVERIFIED | No hook during preview startup |

Home Site source changes were made by Devin/Kalio, not manually by main agent. Goal remains active; this is not full Kalio readiness.
