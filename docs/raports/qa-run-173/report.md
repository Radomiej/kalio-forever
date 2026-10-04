# QA173 — nested Devin catalog Escape regression

2026-10-04, fixed QA http://localhost:5288/ and API :3316, existing AppData data/providers preserved. Read-only manual in-app browser reproduced Escape in Search Devin models closing both catalog and Settings. Catalog showed 773 dynamically discovered models, exact swe-2 and variants, with filesystem/web/terminal unchecked. No token rotation, policy changes or model execution requested.

Cause: catalog had no Escape handler; parent SettingsModal listens on window and closed the entire settings surface. Surgical fix: child handles Escape, prevents default and propagation, closes catalog and restores focus to Browse. Close button/backdrop use the same focus-return handler. Parent behavior remains unchanged.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Regression detects broken behavior | PASS | New unit test observed RED: dialog remained and event reached parent before fix | None for this case |
| Focus and parent preservation | PASS | Seven unit tests across catalog/settings; browser Escape leaves Settings open and Browse focused, second Escape closes Settings | Full focus trapping/other dialogs not proven |
| Typecheck/build | PASS | Web tsc --noEmit, Vite build passed; pre-existing chunk-size warning | Broader release gates remain |
| Deployed browser proof | PASS | New frontend index-DRp--t6T.js served by existing QA preview; in-app browser verification and Chromium E2E 1 passed (3.5s) | No backend redeploy needed |

Build regenerated dist/runtime-config.js; restored API/WS origins from fixed managed-stack state before UI checks. No QA/backend reset or provider mutation occurred. Screenshot assets/settings-after-catalog-escape.png. Test qa-devin-catalog-escape-readonly.spec.ts also confirms exact SWE-2 searchable in catalog. This fixes one observed keyboard defect, not token generation, all settings UX or full objective.
