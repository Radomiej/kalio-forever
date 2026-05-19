# 2026-05-17 21:54 - repo junk cleanup

## What was done

- Reviewed root-level screenshots, debug dumps, mockups, and audit artifacts for stale files.
- Removed stale tracked artifacts with no active references:
  - `docs/mockup/kalio-tycoon.jsx`
  - `lint_output.txt`
  - `tools-page-snapshot.md`
  - `kalio-running-state.json`
  - `new-chat2.png`
  - `snake-done.png`
  - `snake-progress.png`
  - `snake-request.png`
- Removed local untracked/ignored artifacts:
  - root `kalio-*.png` screenshots
  - `.tmp-pr-*.log`
  - `docs/audit/`

## Why these were removed

- `docs/mockup/kalio-tycoon.jsx` was already called out in session notes as a throwaway prototype.
- `lint_output.txt` and `tools-page-snapshot.md` were snapshot/debug artifacts, not maintained source docs.
- Root screenshots and PR temp logs were leftover local artifacts with no current code or doc usage.
- `docs/audit/` contained ignored local audit outputs rather than source-of-truth documentation.

## Verification

- Confirmed the tracked cleanup candidates are now deleted in git status.
- Confirmed no markdown references remain for:
  - `new-chat2.png`
  - `snake-done.png`
  - `snake-progress.png`
  - `snake-request.png`
  - `kalio-running-state.json`

## Remaining notes

- Standard ignored local directories remain (`node_modules`, `.turbo`, coverage, dist, local env files) because they are active development outputs rather than stale one-off junk.