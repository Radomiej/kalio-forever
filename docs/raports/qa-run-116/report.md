# QA116 — Rendered Codex picker still offers unsupported profiles

2026-10-04, fixed QA UI5288. Headf2ea96f plus preserved dirty work. Isolated orchestrator Chromium session74683ae7-fd0f-4eb2-ad40-f6b2de651954,1440x900; opened Talk/new-chat launch screen and provider/model combobox, entered Codex. No prompt, Run, tool approval, profile edit or session creation. Browser session closed after capture; absolute copied screenshot verified86721bytes and visually inspected.

[P2] The rendered option snapshot includes Codex · gpt-5.4 twice (Guard/Strict), gpt-5.4-mini and gpt-5.3-codex-spark as ordinary selectable options. These four profiles were absent from the fresh QA113 account catalog. The deployed runtime guard rejects unavailable models but the picker is not catalog-filtered. Fresh GPT6 models are not present among the Codex options. Existing profile settings must be retained while catalog-based availability is implemented.

The snapshot/screenshot also showed Devin Claude options above Codex results after typing Codex. Do not infer the cause from current dirty source: rendered build/query timing needs a deterministic regression. The screenshot proves the unsupported saved Codex choices, not a submitted invalid-model error.

Acceptance: rendered unsupported options confirmed FAIL; no new generation; runtime error/F5 and HomeSite Codex tools/HITL remain OPEN. Required next is dynamic Codex discovery and validated profile resolution, then exact UI canary after local gates.

[Picker screenshot](assets/codex-picker.png).
