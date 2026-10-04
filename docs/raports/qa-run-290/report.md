# QA290 — sequential workflow obsolete fixture reproduced

2026-10-04, Europe/Warsaw. Isolated built Chromium stack API58469, UI58468, one worker, mock fallback. Fixed QA and Home Site untouched. Existing artifact from QA289, source24ee41b9 plus foreign dirty work.

One test failed at welcome-run-prompt disabled after10s. The session was created without an execution profile or history; current creator correctly requires a selectable provider/model. Failure is fixture setup, not evidence that router execution fails. Saved screenshot70995 bytes, error context17155 bytes, local ignored trace1848165 bytes under failures. No real provider was invoked.

The normal workflow-release-gate script shares .tmp/qa-stack state and uses force-restart; running it directly would stop the user's fixed QA. Used the independent apps/e2e/scripts/run-playwright-with-stack.mjs launcher instead. Full release gate is not claimed run.

Next: use existing isolated mock-conversation helper with explicit profile and seed history; retain workflow-specific assertions. Do not expose mock in the production provider picker to satisfy a test.
