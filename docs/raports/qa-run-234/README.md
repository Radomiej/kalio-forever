# QA234 — Home-site preview unavailable

Date: 2026-10-04. Attempted actual preview audit at http://127.0.0.1:57868/ with expected built script index-BWlm4q-R.js. Fixed Kalio QA remains separate at localhost:5288.

Result: 2 tests FAIL, 6.6s. Both failed at page.goto with net::ERR_CONNECTION_REFUSED before any title, asset, responsive, keyboard or form assertion. Therefore no fresh product/UI quality proof exists in this attempt.

Failure screenshot copied and independently verified at assets/preview-unavailable.png before another Playwright run can clear test-results. No source or configuration changes were made in Home-site.

[P2] Preview availability: the previous agent-started preview is no longer reachable after the managed QA restart. Timing does not establish process termination cause. Next inspect terminal state and restore through a real approved Devin/Kalio terminal request; do not patch or manually launch the target project outside its approved workflow.

Earlier successful QA219 responsive checks and QA229 build remain historical proof of their own scenarios; they do not prove that the preview is available now. Whole objective remains active.
