# QA159 — HomeSite restored, test historical-heading collision

2026-10-04, fixed QA, real Devin SWE-2. Exact npm run preview -- --host 127.0.0.1 --port 57868 --strictPort in E:/Projekty/home-site was inspected and approved through Kalio UI. No direct shell launch of HomeSite was used.

The test then failed because its reused QA148_PREVIEW_RESULT heading matched two historical responses. Independent HTTP verification afterwards returned 200 from :57868 and the session current-run endpoint was empty. This is operational recovery evidence, not a passing full Playwright test.

Evidence: assets/preview-approval.png and assets/duplicate-historical-heading.png. Test selectors now scope arguments to the current confirmation; result headings use report number and timestamp. Do not rerun a preview launch while the endpoint is already live.

The preceding attempt after restart failed before approval because an unscoped Full tool arguments selector matched history. Its confirmation was cancelled; no command was approved in that attempt.
