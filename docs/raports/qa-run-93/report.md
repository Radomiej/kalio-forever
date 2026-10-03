# QA93 — Current generated HomeSite browser audit

2026-10-03. Exact target E:/Projekty/home-site, real built preview http://127.0.0.1:57868/ restored by Devin swe-2 via Kalio UI and manually approved tools in QA92. Kalio fixed QA remains localhost:5288 / API3316. This audit submitted no LLM prompt, changed no target source and reset no data. Chromium desktop browser with emulated viewports; no physical-device claim.

Command: system Node, external-server Playwright, KALIO_HOME_SITE_PREVIEW_URL=http://127.0.0.1:57868/, KALIO_HOME_SITE_REPORT_RUN=93, tests/home-site-live-audit.spec.ts --project=chromium. Exit 0, two tests passed in 2.9 seconds. Test asserts the deployed index-DsbKbAs0.js artifact, not merely source files.

| AC / pitfall | Status | Evidence | Remaining boundary |
| --- | --- | --- | --- |
| Responsive / PIT-04, PIT-09 | PASS | H1 visible, no document overflow at 320/390/1440 | Text enlargement and physical mobile not tested |
| Keyboard menu / PIT-03, PIT-10 | PASS | Open, focus transfer, Shift+Tab trap, Escape and focus return | Pointer close toggle/link navigation not exercised by this test |
| Demo form recovery / PIT-37 | PASS | Three invalid fields, focused first field, successful demo state and reset | No email delivery; explicitly demo only |
| Reduced motion / PIT-09 | PASS | Scroll behavior auto, menu transitions at most 0.01s | Not a full accessibility audit |
| Hero long word | PASS | oprogramowanie occupies one text range fragment at 320px | Other arbitrary content not tested |
| Complete project / integrations | OPEN | This proves the current rendered artifact only | Fresh build/tool chain, queue and broader ChatGPT acceptance remain |

## Saved browser evidence

- [320px full page](assets/home-site-320.png), [hero](assets/home-site-hero-320.png)
- [390px full page](assets/home-site-390.png), [hero](assets/home-site-hero-390.png)
- [1440px full page](assets/home-site-1440.png), [hero](assets/home-site-hero-1440.png)

QA and preview returned HTTP200 immediately before this audit. No production proof or newly generated site is claimed. The existing test's pointer/menu gaps remain explicit rather than being inferred from keyboard success.
