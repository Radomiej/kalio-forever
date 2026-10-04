# QA203 — source closure checkpoint and launch regression review

2026-10-04. Commit7a276e87 saved exact-turn audit fix and QA197-202 reports/screenshots; index and those committed paths clean. HTTP probes confirmed QA localhost:5288 and HomeSite127.0.0.1:57868 both200. No restart or new LLM invocation.

Reviewed remaining NewChatScreen diff: compact two-step flow uses lg:contents to retain simultaneous desktop setup/prompt, narrower mode switcher, canRun guard for submit, draft retained until caller succeeds. Existing tests cover draft retention, required runtime selection and Back/Next retention. These are component/logic tests, not rendered CSS proof.

| Acceptance / pitfall | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Draft retained through launch and retry | PASS locally | NewChatScreen/useChatLaunchSend,5tests2files passed, exit0,1.22s at12:33:12 | Review hook/caller source before commit |
| Desktop all controls vs compact wizard | UNVERIFIED for this checkpoint | Source classes reviewed | Exact breakpoint browser geometry/keyboard proof required |
| PIT-04 target and PIT-11 artifact | CHECKED | Current fixed QA and preview HTTP200, backend e53b3377/frontend QA188 | No new frontend deploy in this run |
| PIT-09 responsive and PIT-18 next action | UNVERIFIED | Existing test preserves prompt and blocks missing runtime | Browser interaction not exercised here |

Expected selection-failure test logs an error; no warning suppression. Existing landing-live-audit targets old QA85/Codex5.6-luna history and cannot prove the current New Chat creation screen. Do not run it and mislabel that as current wizard acceptance. Next browser test must target New Chat itself without submitting a live prompt, with desktop and compact states, draft retention and boundary widths.

No UI source changes or staging yet; unrelated/image-agent work preserved. Goal remains active.
