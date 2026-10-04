# QA215 — launch retry project isolation

Date: 2026-10-04. Boundary: local frontend tests; no live agent request or QA deployment in this run.

## Finding and correction

[P1] After creating a chat and failing to persist its model selection, launch retry cached that chat without its project scope. Changing the project before retry could reuse the previous project's chat.

`useChatLaunchSend` now reuses a cached draft only when both project ID and project path match. A changed scope creates a fresh chat before persisting selection, activation, and sending. The previous draft is retained, not deleted. Same-scope retry remains supported.

## Evidence

| Check | Status | Evidence / boundary |
| --- | --- | --- |
| Full frontend suite before this correction | PASS | 214 files, 1872 tests, 33.65s; start 13:07:28. Ignored local log: `.tmp/qa215-frontend-vitest.log`. |
| Project-ID and project-path retry regressions before correction | FAIL as expected | 2 failed, 4 skipped; start 13:08:43. Both observed one creation instead of two. |
| Launch hook, ChatInterface, NewChatScreen after correction | PASS | 3 files, 102 tests, 3.13s; start 13:09:08. |
| Frontend TypeScript check after correction | PASS | `tsc --noEmit`, combined command exit 0. |
| Tracked diff whitespace check | PASS | `git diff --check`, exit 0; line-ending warnings only. |
| Browser / fixed QA proof of this correction | NOT RUN | Source fix is not deployed by this run. |

Test output contains expected failure-fixture logging and ChatInterface mock API warnings. Passing assertions do not establish a warning-free runtime. The full suite result predates the correction; only the focused suite and typecheck were rerun afterwards.

## Remaining

Review the coherent, currently dirty launch-source bundle before staging. Build and deploy it, then verify project-switch retry in the browser. This run does not prove Devin, Codex, Jev, CMD-process behavior, or the complete delivery goal.
