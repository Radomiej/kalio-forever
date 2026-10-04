# QA119 — Deployed dynamic Codex picker and Devin preview

2026-10-04. Built FE7e0a4fb and API8edcbf8/d385a6d plus preserved dirty build changes. Both explicit canary sessions had no current run. Verified prior launcher25180, stopped only that QA launcher/managed stack, launched hidden start-qa.ps1 -SkipBuild; new launcher17480, same AppData DB and fixed ports.

Devin static readiness16/16 PASS. Real SWE-2 UI preview recovery PASS9.6s (test8.8s): individual reviewed Kalio npm preview approval and durable matching running result. No target writes or build.

New Chromium1440x900 catalog/profile-only test PASS5.1s(test4.2s). UI explicitly Recheck Codex models reads real model/list; searches Codex · gpt-, shows GPT6Luna, omits CodexGPT5.4/GPT5.3 options, selects GPT6Luna. Actual POST body authProfileId=chatgpt-default/model=gpt-6-luna; API returns matching strict profile. Input displays chosen model; prompt remains empty. No Run, generation, tool or chat creation. Screenshot visually inspected. The parent hint still says choose a provider; full run readiness after resolving a newly created profile is not proven by this selection-only test.

Profile count20: added codex-local-1bd82ba45243e8a3a0c4aa0478538f67. Original19 hash remains DF8DD360EF8A6B12FAA2EDBA7E6913D5F8110A4331E45A26BDCE79065D11714B. No original profile mutations; not a credential backup proof. Final UI5288/API3316health/HomeSite57868 HTTP200.

| Acceptance | Status | Boundary |
| --- | --- | --- |
| Fresh account models/select strict new profile | PASS QA | Real model/list/API persistence and rendered selection |
| Unsupported saved Codex models omitted | PASS QA | Scoped Codex search, not all providers |
| Original profiles preserved | PASS | Same19-profile hash plus one intentional new profile |
| Real Devin preview recovery | PASS QA | Reviewed Kalio tools and HTTP200 |
| New-profile chat launch/HomeSite tools/HITL | OPEN | No prompt sent; parent hint needs follow-up |
| Full native categories/CMD stress | OPEN | Not proven here |

Screenshots: [catalog](assets/codex-catalog.png), [selected](assets/codex-selected.png), [preview approval](assets/preview-approval.png), [preview result](assets/preview-completed.png).
