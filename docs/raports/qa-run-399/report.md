# QA399 — real Devin follow-up after Stop and queue cancellation

2026-10-04. Checkout `C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever`, HEAD `4477150e`, pre-existing unrelated changes preserved. Fixed QA UI http://localhost:5288/, API http://127.0.0.1:3316/api, AppData profile `kalio-forever-qa`. In-app browser existing tab 6, ordinary viewport (no override). Exact approved project `E:/Projekty/home-site`, session `W4fggLSunrJB41C24MV7C`, explicit Devin ACP model `swe-2`, strict bridge and six-tool allowlist. No restart, settings change, writes or terminal command.

Fresh static Devin readiness: 17/17 PASS. Submitted `QA399_POST_STOP` through Chat message / Send message: exactly one Kalio fs_read of package.json, with instruction not to resume cancelled QA397 work. This is a live provider test, not a mock.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| New real Devin turn after Stop | PASS | Turn UVPCLkQwA9RHruNzD9nU6 started as swe-2 and completed in ACP + llm audit | Other lifecycle combinations separate |
| Correct Kalio tool and file | PASS | One call mcp-8d4070fb-a0ab-45ad-ab24-ce1d4edb4a94-8, fs_read success; rendered Kalio source label and exact package path | Does not prove provider-native capabilities globally |
| Final rather than hanging thinking | PASS for this turn | Assistant g8HLDRA5kg3WRIUs80AcI has thinking length 0, final QA399_RESULT, Stop count 0, current run HTTP body empty | Late event race coverage separate |
| F5 hydration | PASS | After transient Connecting state, waited for visible QA399_RESULT; same final and Stop count 0 | Backend restart separate |
| Chat/graph parity | PASS for this turn | Graph shows swe-2, Turn completed, Tools 1, fs_read, final with name nexora-home-site and scripts.build vite build | Grouping multi-tool turns/general architecture separate |

Agent prose about the queue is not the cancellation proof. QA397 readonly DB evidence supplies that proof independently. Audit tool records have no turnId, so attribution uses exact session and this observed new-turn interval plus call ID, not a fabricated tool turnId.

Screenshots: [chat after F5](assets/post-stop-f5.png), [graph](assets/graph-post-stop.png). Screenshot graph is viewport-only; DOM inspection supplies complete latest-node text. No new target build was requested; `vite build` is the read script value, not a claim of an executed build. No console/network log capture or console-window measurement this run. SWE-2 pricing was not reverified. No source change or deployment in this run.

Overall goal remains open: short-lived console windows, Jev loop integration and remaining broader acceptance gates are not closed by this test. Existing Home Site and fixed QA were left available. No external Linear/Notion sync.
