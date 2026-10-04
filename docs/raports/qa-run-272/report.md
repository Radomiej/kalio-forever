# QA272 — AC21 first-prompt title regression reproduced

2026-10-04, Europe/Warsaw. Isolated Chromium, one worker, existing builds. System Node outside sandbox, apps/e2e/scripts/run-playwright-with-stack.mjs ac-21-session-title.spec.ts. UI 65473, API 65474; storage data/playwright-stack/1791122478978-50320. Fixed user QA untouched.

Result **1 passed, 1 failed (11.8s), exit 1**. Generate-title API case passed. UI case failed before submitting its first prompt: welcome-run-prompt remains disabled because no execution profile was selected. Therefore this attempt does not prove an auto-title runtime defect or recovery. It confirms the obsolete test setup is incompatible with the explicit profile-selection contract. Do not expose mock in the production model picker or weaken Run eligibility to make this test green.

An initial launcher invocation used the incorrect root-relative script path and exited MODULE_NOT_FOUND without starting a stack. Repo package scripts established the correct apps/e2e/scripts path; the actual test then ran and terminated. Failure screenshot/context/trace copied with absolute paths and byte-length verification. Trace remains local and ignored.

| Area | Status | Evidence | Remaining |
|---|---|---|---|
| Title API | PASS | Existing AC21 API case | Case creates an empty session despite its title; not a first-reply test |
| New-chat title UI | FAIL / setup mismatch | Run disabled before send | Prepare an explicit isolated selectable provider without exposing production mock; retain first-prompt semantics |
| Fixed QA preservation | Unchanged by this run | Disposable storage and random ports | Not a fresh fixed-QA health measurement |
| Overall goal | NOT CLOSED | Regression remains unresolved | No completion claim |

Do not use initialized-existing-conversation helper to close this first-prompt requirement: its initialization already adds a first turn and would change the tested contract. Next work must provide a suitable isolated provider fixture and prove actual UI first reply, title update and hydration.
