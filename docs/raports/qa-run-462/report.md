# QA462 — direct Windows version probes for all four adapters

Date: 2026-10-06. Local built API; no QA restart in this run.

Copilot/Claude/Codex resolve installed native executables from package roots
derived from PATH. Gemini resolves its installed bundle and invokes it using
the API's Node executable. Version probes no longer need cmd/npm launchers when
these package targets exist. Explicit cliPath, non-Windows behavior, legacy
missing-package fallback, serialized queue, cache and invocation audit remain.
This changes version probes only, not agent task execution or permissions.

Verification:

- New Codex/Gemini regressions failed before implementation (2 failed/4 passed).
- Full CLI module: 13 files, 94 tests passed.
- API typecheck exit 0, build exit 0, 0 issues, 686 compiled files.
- Actual built resolver plus direct --version, windowsHide true, timeout 5000:
  Copilot 1.0.23, Claude Code 2.1.220, Codex CLI 0.155.1, Gemini 0.52.0.
  All returned exit 0 without an LLM task or software update.

| Requirement | Status | Remaining |
| --- | --- | --- |
| Direct default version probes for four installed adapters | PASS locally | QA rollout/startup trace |
| Existing CLI module regression | PASS | 94/94 |
| Build and typecheck | PASS | both exit 0 |
| No cmd descendants at QA startup | UNVERIFIED | currently running QA uses older code |
| No visible flashing | UNVERIFIED | requires matching post-deploy window capture |

No target-project edits or QA settings changes were performed. Keep startup
flashing open until a controlled rollout and trace verify the user-visible path.
