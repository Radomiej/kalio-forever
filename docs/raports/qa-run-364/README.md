# QA364 — rendered Home Site responsive regression

2026-10-04, actual rendered build at http://127.0.0.1:57868/, restored through real Devin/Kalio in QA363. No source edits.

Browser viewport override initially targeted the wrong tab: observed1280, not claimed320. Rebound exact Home Site tab4 and verified actual innerWidth before acceptance.

PASS320: innerWidth320, document scrollWidth305, closed header navigation display:none. Open menu exposed links and focused Usługi. Escape followed immediately by native Tab focused Porozmawiaj z nami outside header navigation; aria-expanded=false, nav display:none. Screenshot mobile320.png.

PASS1440: innerWidth1440, scrollWidth1425, header nav flex, toggle display:none. Tab from final header link Bezpłatna wycena advanced to Porozmawiaj z nami outside navigation, no desktop trap. Screenshot desktop1440.png.

Temporary viewport override reset; Home Site tab retained as deliverable, QA tab retained for continued testing. These rows close the explicit320/1440 responsive regressions, not full accessibility or production readiness. Form negative/positive/reset evidence is recorded separately in QA358; lifecycle recovery in QA362. Other application requirements remain open.
