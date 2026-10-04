# QA158 — real Devin reset and same-chat recovery

2026-10-04, fixed QA :5288/:3316, deployed backend build (680 files, zero TypeScript issues), frontend build passed.

PASS: Chromium live test 1 passed (9.7s). Exact Devin SWE-2 in session W4fggLSunrJB41C24MV7C streamed visible output, its sole host was reset via unchanged settings, and F5 preserved the partial response with an Interrupted indicator. A new prompt in the same conversation returned QA158_RECOVERED_1791100491113 from a different process epoch. Final F5 retained it with no running/connection indicator.

Audit assertions: zero tool calls and zero process.cmd.invocation entries during the test. Native filesystem/web/terminal remained disabled. Screenshots assets/before-host-reset.png and assets/recovered-after-f5.png; the latter was visually inspected.

Before restart a consistent SQLite backup was taken at ignored .tmp/qa-provider-backup/qa-before-reset-recovery.db. After restart credentials, app_settings and execution_profiles had identical row hashes; integrity_check was ok. No secrets are included here.

Scope: real external-host exception recovery with non-empty output. Empty-output failures and all broader lifecycle/provider acceptance rows are not closed by this test.
