# QA151 — Real ChatGPT/Codex command denial and follow-up

2026-10-04. Fixed QA http://localhost:5288/API3316, existing AppData DB/provider settings unchanged. Model `gpt-6-luna`, strict Codex app-server profile `codex-local-1bd82ba45243e8a3a0c4aa0478538f67`, session `yvD83rgDA_ZHvUwJKlo_S`, workspace `E:/Projekty/home-site`. No host reset or target source edits.

After QA150 locator failure, current-run endpoint was empty and exact existing-session readiness passed. The corrected locator scopes full arguments to the single tool bubble containing the pending Cancel button. Test submitted through Kalio Talk, validated exact `npm` / `["run","build"]` / approved cwd payload, clicked Cancel, and sent a no-tool follow-up.

Chromium PASS 18.2s (scenario 17.3s). Two completed turns, exactly one attempted Kalio `terminal_spawn`, exactly one `tool.confirmation.denied`, zero `process.cmd.invocation` for both turns combined, unchanged host epoch. Denied turn `R5N353MORX7aQV2Niyn-o`; follow-up `Q-FetYC1lSkg4Kz8JPmYn`.

| AC / PIT | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Real command rejection / PIT-36 | PASS QA | Exact payload, Cancel and durable refusal answer | Other tools/approval modes not exercised |
| No execution or retry / PIT-03,37 | PASS QA | One tool attempt, zero audited CMDs | Not OS-wide burst tracing |
| Conversation after refusal | PASS QA | Follow-up completed, same process epoch | Reconnect/account reauth not exercised |
| F5 hydration / PIT-05 | PASS QA | Both headings survive, no Stop/reconnect banner | Other runtime panels not exercised |
| Services remain available | PASS | QA5288 and HomeSite57868 HTTP200 after test | Preview remains tied to QA terminal lifecycle |

Screenshots: [pending command](assets/command-awaiting-denial.png), [refusal and follow-up after F5](assets/denied-followup-after-f5.png). Final screenshot visually inspected: Kalio terminal card reads cancelled, final response is normal chat content. Shared test now refuses simultaneous Devin/Codex flags and allows a distinct numeric report folder per attempt. Whole goal remains open.
