# QA236 — actual Home-site audit after recovery

2026-10-04. Actual preview http://127.0.0.1:57868/, explicit built asset index-BWlm4q-R.js. Restored by real Devin in QA235, not launched manually outside Kalio.

home-site-live-audit.spec.ts: 2 PASS, 5.6s. Tested 320/390/1440px without horizontal overflow, H1 and hidden mobile menu; menu focus, reverse-Tab wrap, Escape/focus return, button/link closing; demo-form invalid fields/focus, submit and clear/reset; reduced motion and intact long hero word at 320px.

Six new PNGs under assets: full-page and hero captures at each viewport. Mobile 390px hero visually inspected. This supersedes only QA234's current preview availability boundary; that failed attempt is retained.

Boundary: fictional company React demo with explicitly non-sending form, not production contact delivery. No tablet-specific 820px, full axe/contrast audit, all-device acceptance or production hosting is claimed. Fixed Kalio QA and project preview remain available for manual review.
