# QA320 — deploy startup diagnostics to fixed QA

Date: 2026-10-04. API system-Node Nest build passed: TSC zero issues, SWC 681 files.

Before restart: both test sessions' correct `/sessions/:id/runs/current` endpoints returned HTTP 200 with zero body bytes; runtime-watchlist empty. Initial incorrect `/current-run` paths returned 404 and were not treated as idle proof.

SQLite online backup: `.tmp/qa-provider-backup/qa-before-320.db`, integrity_check=ok. Credentials, execution_profiles and app_settings compared by SHA-256 over ordered rows before/after restart: all unchanged. No credential values emitted.

Managed restart: fixed API 3316, UI 5288, existing AppData kalio-forever-qa data root, skip-build, force-restart, use-env-llm. Manager completed successfully. UI HTTP 200. Existing fallback provider remains mock with forceEnvLLM not requested; persisted native execution profiles are unchanged. This is not proof that a fresh chat automatically selects Devin.

Backend log: `.tmp/qa-stack-logs/backend-1791135280037-43148.log`. New DevinMcpStartup logging is built and deployed. No startup-probe records found immediately after stack boot: no real Devin host start was performed in this slice. Must trigger through the approved UI and correlate direct PID records with descendants/windows before declaring the reported console issue fixed.

| Acceptance | Status | Remaining |
| --- | --- | --- |
| Build and fixed-QA restart | PASS | Manager success, UI 200. |
| Preserve provider configuration and credentials | PASS | Backup integrity + three matching table fingerprints. |
| Real Devin startup instrumentation | UNVERIFIED | Deployed but not triggered by a real UI run yet. |
| No transient startup windows | UNVERIFIED | HTTP/source checks cannot prove window visibility. |

No Home Site mutation, database reset, protected contract edit or installer execution occurred. Managed restart can interrupt detached test terminals; Home Site preview must be checked separately before reusing its earlier URL.
