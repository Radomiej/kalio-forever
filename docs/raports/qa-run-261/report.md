# QA261 — queued follow-ups and 429 recovery

2026-10-04, Europe/Warsaw. PASS for three isolated browser cases; full release still NO-GO.

QA257 failed both AC13 queue cases and the deterministic 429 recovery case before submission: their empty chats had no eligible profile. They now use the explicit existing mock-conversation fixture, without adding mock to normal production model selection.

## Stronger evidence

- First queue case verifies the active durable turn ID remains unchanged immediately after an extra UI submission, then waits for drain and exactly two new assistant turns.
- Rapid Enter submits three distinct follow-ups during a scripted six-second diagnostic hold. Four new user messages and exactly four new assistant turns are required, with no current run or Stop control after drain.
- The 429 fixture uses its session-bound execution profile rather than changing global active credentials. The actual deterministic provider error reaches the UI; input re-enables, the pending dot disappears and the agent panel becomes idle. A successful post-error response is not claimed by this case.

The hold makes the queued phase observable; it is not a runtime stabilization fix. Initial fixture messages cannot satisfy new-turn counts. No production source, real project files, fixed QA providers or credentials changed.

## Verification

System Node, outside sandbox, serial worker, existing builds:

`node scripts/run-playwright-with-stack.mjs ac-13-anti-spam.spec.ts regression-mock-llm-429-recovery.spec.ts --project=chromium --workers=1 --reporter=line`

`KALIO_PLAYWRIGHT_SKIP_BUILD=1`; isolated UI/API `52535/52536`, storage `data/playwright-stack/1791120362926-41132/`. Terminal **3 passed (17.7s), exit 0**, 15:26:24. The 429 error in logs is the expected negative scenario, not an unexpected production incident.

| AC | Status | Proof | Remaining |
|---|---|---|---|
| Queue admission/drain | PASS | Stable active turn plus exact subsequent turn counts through UI | Live Devin queue proof is separate |
| Rapid distinct submissions | PASS | Three queued messages, one answer per request, no active run after drain | Does not prove identical-request idempotency |
| Provider error recovery | PASS | Visible 429, enabled input, no pending dot, idle agent panel | Successful subsequent generation not covered |
| Full Chromium sweep | FAIL / not rerun | QA257; 14 formerly failed cases now recovered in focused runs | 23 other failed cases remain unresolved |

## Next investigation boundary

The workflow creator uses the same execution-profile admission check as single chat (`NewChatScreen.canRun`), and `useChatLaunchSend` rejects a missing selection. Source inspection alone does not establish a production bug: the product requires explicit provider/model selection, while architectures also have their own role execution contracts. Trace the actual workflow launch consumer and role profiles before changing admission. Do not make mock visible or silently select an unrelated live provider to green old architecture tests.

No fixed QA restart/deploy, new Devin/Codex turn, full local root-gate rerun or production claim is made. Prior RED screenshots and traces are retained in QA257.
