# Session Log

- What was done: removed redundant standalone GitHub Actions workflows so `main` relies on `.github/workflows/ci.yml`; removed an accidental root `package-lock.json`.
- Files touched:
  - `.github/workflows/audit.yml`
  - `.github/workflows/backend-ci.yml`
  - `.github/workflows/e2e.yml`
  - `.github/workflows/frontend-ci.yml`
  - `package-lock.json`
  - `docs/sessions/2026-05-09-22-31-workflow-cleanup.md`
- Decisions made:
  - Kept the consolidated `ci.yml` workflow because it already covers backend, frontend, audit, and E2E jobs.
  - Removed the legacy standalone workflows because they duplicate CI and two of them are currently failing on `main`.
- Open questions:
  - If audit artifacts are still needed, they should be added to `ci.yml` in a follow-up instead of restoring a separate workflow.
- Next steps:
  - Badge update done: `README.md` now points at `.github/workflows/ci.yml` instead of the removed workflows.
  - Update README status badges and any workflow-linked docs so they reference `.github/workflows/ci.yml` instead of the removed `backend-ci.yml`, `frontend-ci.yml`, and `audit.yml` workflows.
