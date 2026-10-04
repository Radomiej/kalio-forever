# QA289 — REST deletion drains active workflow requests

Date: 2026-10-04, Europe/Warsaw. Isolated built Chromium stack on random API port 58470, one worker, local deterministic HTTP/SSE provider. Fixed QA 3316/5288 and Home Site preview left running, no reset, no real LLM requests or provider changes.

## Cause and repair

SessionsController DELETE /sessions/:id calls SessionRuntimeStopService before removing the session tree. This sibling still awaited architecture drain before invoking subagent abort, even after socket Stop had been repaired. Architecture can wait on those same role requests. Fail-first regression showed zero subagent cancellation calls while architecture drain was held pending (one failed, two passed).

The service now initiates architecture, AgentFlow, subagent, CLI and pipeline cancellation before awaiting all of them. Existing attempt/error aggregation is retained: failures still prevent deletion, but do not skip draining other owners. No API/shared-contract change, no new timeout in production.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| REST-CANCEL-01 | PASS | RED missing cancellation; GREEN all three session-stop tests including failure propagation | More lifecycle twins not exhausted |
| REST-CANCEL-02 | PASS | Gateway50 + session-stop3 + architecture96 =149 unit tests; API tsc/Nest build exit0,680 files | Full release gate not rerun |
| REST-CANCEL-03 | PASS | UI creates strategic-decision-council with explicit local HTTP provider; active stream observed; DELETE finishes within5s against8s fixture; streams zero; exact session GET404 | Test-only session/data; no live Devin deletion |
| SOCKET-PARITY | PASS | Normal UI Stop test still cancels/user_stop, zero streams, settled UI after F5 | Live architecture-role provider mix not tested |
| QA-DEPLOY | UNVERIFIED | Current fixed QA process not restarted for this change | Deploy after broader readiness; preview would require restore on restart |

Browser command from apps/e2e: system Node outside sandbox, KALIO_PLAYWRIGHT_SKIP_BUILD=1 after fresh backend build; `node scripts/run-playwright-with-stack.mjs workflow-stop-runtime.spec.ts --project=chromium --workers=1 --reporter=line`. Two tests passed in5.1s, exit0. Isolated delete-workflow id xHrTEvZ1uNjs8UFr77R9Y. Screenshots copied before any further run.

Verdict: local REST deletion and socket parity slice PASS. Full original objective remains active; fixed QA deployment and remaining integration/UX/Jev gates are not implied.

Saved captures verified at 56210 and 108333 bytes: [deleted session after F5](assets/deleted-workflow-after-reload.png), [socket Stop after F5](assets/stopped-workflow-after-reload.png).
