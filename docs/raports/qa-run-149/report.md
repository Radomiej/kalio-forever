# QA149 — Real Devin command denial and follow-up

2026-10-04, fixed built QA UI http://localhost:5288 and API3316, existing AppData data/provider configuration unchanged. Checkout `codex/kalio-provider-runtime-ux`, HEAD `569c5c3a`, large pre-existing dirty tree preserved. Exact SWE-2 strict profile in session `W4fggLSunrJB41C24MV7C`; current-session readiness PASS before the prompt.

Chromium submitted one request for Kalio `terminal_spawn` (`npm`, `["run","build"]`, cwd `E:/Projekty/home-site`). Test inspected arguments and exact audit payload, clicked Cancel, then submitted a no-tool follow-up. PASS 7.8s (scenario 6.9s). No command or target write was executed.

| AC / PIT | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| User denial reaches Devin / PIT-36 | PASS QA | One `tool.confirmation.denied`; real answer acknowledges refusal | Other tool categories not tested here |
| No execution or retry / PIT-03,37 | PASS QA | One attempted tool call, zero `process.cmd.invocation` throughout both turns | Not OS-wide process tracing |
| Follow-up without host reset | PASS QA | Two completed turns, equal host epoch | Host reconnection not tested |
| Durable UI recovery | PASS QA | Both unique headings after F5, no Stop/reconnect banner | Other panels not tested |
| Native audit affordance | P3 observation | No-tool response still offers `Native tool audit` | It is a lazy audit disclosure, not execution evidence; UX refinement deferred |

Denied turn `roygJ65w1bxkDeYgwNHBp`, follow-up `CyfctujgsOk25qqbzD82p`. Screenshot visually inspected: cancelled Kalio terminal card and real follow-up response render correctly.

Screenshots: [awaiting denial](assets/command-awaiting-denial.png), [follow-up after F5](assets/denied-followup-after-f5.png). No provider reset, backend restart or source rebuild. This proves the explicit command-denial flow, not completion of the entire goal.
