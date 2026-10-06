# QA465 — scoped Gemini version-probe relaunch suppression

Date: 2026-10-06. Local API only, no QA restart or project mutation.

Resolved Gemini version probes receive GEMINI_CLI_NO_RELAUNCH=true in their child
environment. Parent environment, configured cliPath, other probes and agent-task
execution are unchanged. This uses the installed launcher's supported branch;
no vendor patch, global setting, sandbox flag or permission override is applied.

Regression sequence: the resolver's new environment expectation failed before
the change; focused resolver/service tests subsequently passed 11/11. Service
tests verify the flag is delivered with inherited PATH and does not mutate the
parent environment. API typecheck and build passed (0 issues, 686 files).
Actual Gemini --version returned 0.52.0 with exit 0 and unchanged parent env.

| Requirement | Status | Remaining |
| --- | --- | --- |
| No relaunch for resolved Gemini version probe | PASS locally | scoped flag/real version command |
| No global or agent-task environment mutation | PASS | service regression, no task service edits |
| Typecheck/build | PASS | both exit 0 |
| Post-deployment startup descendant reduction | UNVERIFIED | running QA still uses earlier build |
| User-visible console flashing eliminated | UNVERIFIED | no matching window capture |

Gemini's existing hidden chcp call may remain. Do not equate all cmd/conhost
processes with visible windows. Current QA and Home Site preview were not stopped.
