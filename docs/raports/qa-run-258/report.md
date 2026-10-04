# QA258 — streaming and WebSocket fixture recovery

Date: 2026-10-04, Europe/Warsaw. Verdict: PASS for six specified isolated browser cases; full release remains NO-GO (QA257).

## Change and acceptance

The new creator intentionally hides mock from normal model selection. Old tests created an empty session without an execution profile and then attempted to submit through the creator. Their failure happened before the requested streaming/error behavior.

`helpers/existing-mock-conversation.ts` creates an explicit mock profile and initializes an existing conversation through the real Socket.IO backend, only when storage is under `playwright-stack/`. It disconnects in `finally` and removes a failed session. Initialization is fixture setup; the tested messages still originate in browser UI. No production source, provider credentials, fixed QA data, or picker behavior changed.

The streaming test records the initial assistant-turn count and requires one additional turn, inspecting the last response. The seeded answer cannot satisfy its assertion.

| AC | Result | Proof | Remaining |
|---|---|---|---|
| AC01 streaming | PASS | Browser adds a new assistant turn and returns to enabled composer | Real-provider streaming has separate QA evidence |
| AC01 error and SESSION_NOT_FOUND | PASS, 2 cases | Existing session deleted; browser submits and receives error/re-enabled composer | None for these isolated cases |
| AC08 error/recovery/resend input | PASS, 3 cases | Actual backend errors reach UI; dismiss permits further input | Resend case checks input acceptance, not a successful second answer |
| Full suite | FAIL / not rerun | QA257: 37 failures | 31 other cases remain unresolved; rerun full gate after repairs |

## Verification

RED: QA257 failed all six cases at disabled `welcome-run-prompt`.

GREEN: system Node, outside sandbox, one worker, existing builds:

`node scripts/run-playwright-with-stack.mjs ac-01-streaming.spec.ts ac-08-ws-error-handling.spec.ts --project=chromium --workers=1 --reporter=line`

`KALIO_PLAYWRIGHT_SKIP_BUILD=1`; isolated API `http://127.0.0.1:61994`, storage `data/playwright-stack/1791119712846-53244/`. Terminal exit 0: **6 passed (6.2s)** at 15:15:22. Expected SESSION_NOT_FOUND logs are negative-path evidence, not a clean log claim. `git diff --check` passed with existing CRLF warnings. No new screenshots are required for non-visual fixture preparation; QA257 retains RED screenshots and traces.

The root local gate passed before this test-only change (QA256); it was not rerun in QA258. No new production deployment or live Devin/Codex turn is claimed.
