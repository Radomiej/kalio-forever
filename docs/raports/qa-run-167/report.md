# QA167 — latest backend deployed, providers preserved, real preview

2026-10-04, fixed QA :3316/:5288. Deployed backend built after QA166's 630-test chat gate and API typecheck/build. Latest frontend includes QA163's user-only failure projection. Build tree contains uncommitted runtime changes; this is not a clean-commit release receipt.

Consistent SQLite backup: ignored .tmp/qa-provider-backup/qa-before-167.db. After restart, credentials/app_settings/execution_profiles row hashes were UNCHANGED; integrity_check ok. Database AppData path preserved, no token rotation or data reset.

Authenticated exact SWE-2 cold static readiness passed. Actual Kalio UI preview-recovery test: 1 passed (11.9s). One inspected/approved npm preview command in E:/Projekty/home-site, zero CMD audit events before confirmation and exactly one after. Only terminal_spawn/output called; normal response survives F5. HTTP200 and rendered HomeSite H1 verified. Three screenshots in assets/.

The deployed subagent persistence fix has a 38-test focused / 630-test whole chat-module local gate; this preview test exercises real Devin chat, not a live nested-subagent failure.
