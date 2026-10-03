# QA run 79 — durable responsive browser proof

2026-10-03. Fixed QA http://localhost:5288/, actual HomeSite preview http://127.0.0.1:57868/. QA78 frontend index-DwooXRXt.js. Existing empty QA77 session reused: no New, delete, Run, credentials, target-file writes or model requests. Playwright launched disposable helper stacks, but tests visited the real fixed QA and actual HomeSite; no network mocking.

| AC / PIT | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Sequential launch / PIT-09 | PASS | Configuration and prompt separately at 320/390/820; conversation list hidden through its visible navigation control | Physical-device touch not tested |
| Selected runtime / PIT-03, PIT-26 | PASS | Default persona + exact Devin CLI · swe-2; header matches; explicit conditional pricing disclosure | No billing entitlement verification |
| Back/Next / PIT-37 | PASS | Model and exact unsent draft preserved at all three widths | F5 draft persistence not tested |
| Horizontal overflow / PIT-24 | PASS | documentElement.scrollWidth <= innerWidth at each configuration width | Text enlargement/forced colors not covered |
| Actual HomeSite / PIT-36 | PASS | Existing two live-preview tests: 320/390/1440, keyboard menu/focus/Escape, demo validation/retry, reduced motion and intact 320px hero word | Form is deliberately non-sending demo; no new build/inference |
| Durable visuals / PIT-29 | PASS | 12 PNGs under assets; visually inspected launch-config-320 and launch-prompt-820 | Other screenshots captured with assertions, not individually reviewed |

## Commands and correction history

System Node, outside sandbox, KALIO_PLAYWRIGHT_SKIP_BUILD=1. Canonical runner: node apps/e2e/scripts/run-playwright-with-stack.mjs.

1. Combined wizard + HomeSite: 2 PASS, wizard timeout. Resizing a desktop with the list open leaves the narrow list visible. Test needed the visible Hide conversations action; not Devin failure.
2. Wizard retry: 320px passed and screenshots captured; next width timed out because the selected option accessible name gains `Selected`. Source and failure DOM confirmed this exact suffix.
3. Corrected bounded selector permits only that optional suffix. Final wizard: 1 PASS, 2.6s test / 3.6s suite. No source correction was needed for either test navigation issue.

Helpers: first API53777/UI53776, second API61009/UI61008, final API54282/UI54281. Each runner terminated; fixed QA was not reset. Initial startup output was truncated; definitive test exits/results were read separately.

Whole requested goal remains active. This run does not prove live >60s HITL, all lifecycle twins, native-hook isolation, no-CMD-spam during inference, or remaining CTO settings/permissions requirements.
