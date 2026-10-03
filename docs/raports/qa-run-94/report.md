# QA94 — Mobile menu pointer close is blocked

2026-10-03, actual generated HomeSite artifact at http://127.0.0.1:57868/, built index-DsbKbAs0.js. Exact project E:/Projekty/home-site. Chromium viewport 390x844 at failure; responsive screenshots also captured at 320/390/1440. Kalio QA remains localhost:5288, same provider settings/data. No LLM prompt, source mutation or command approval occurred in this audit.

Expanded existing browser regression to cover the same menu toggle's pointer close and link navigation, independently from Escape. Command: external-server Playwright tests/home-site-live-audit.spec.ts --project=chromium, KALIO_HOME_SITE_REPORT_RUN=94. Exit1; one test failed, one passed, 32.5 seconds.

## Finding

[P2] The open nav#menu-glowne intercepts pointer events targeting the visible/enabled button labelled Zamknij menu. Playwright click retries until the 30-second test timeout. Keyboard Escape and focus return passed before the pointer test. This is an actual user-facing overlay defect, not a missing selector; do not use forced click to hide it.

| AC / pitfall | Status | Evidence | Next |
| --- | --- | --- | --- |
| Pointer close / PIT-10, PIT-37 | FAIL | Native click intercepted by nav overlay | Real Devin through Kalio must repair generated target |
| Escape/focus return | PASS | Earlier assertions in same run | Retest after repair |
| Link navigation close | UNVERIFIED | Execution did not reach link action | Retest after repair |
| Hero word at 320px | PASS | Separate second test | Preserve after repair |
| Form/reduced motion | UNVERIFIED this run | Abort before those assertions; QA93 earlier passed | Retest after repair |

[Failure screenshot](assets/mobile-menu-close-blocked.png). Earlier responsive screenshots in assets/home-site-{320,390,1440}.png are retained. Trace/error-context live in ignored apps/e2e/test-results and may be overwritten by future runs; decisive error is documented above.

Repair scope: only menu stacking/hit testing in HomeSite, preserve keyboard trap/Escape/focus return/reduced motion. Require real Kalio fs_read/fs_write plus per-write approval and manually approved npm run build. Do not patch target source directly. Restart preview through approved Kalio tools if needed and rerun full browser audit on the rebuilt artifact. This report does not close the full integration goal.
