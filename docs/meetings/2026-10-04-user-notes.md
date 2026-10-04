# User notes — 2026-10-04

Source: user messages in the current Codex conversation. Timezone: Europe/Warsaw. Individual message times are not available; date only is recorded, without invented timestamps. Entries below are normalized paraphrases, not verbatim transcripts. Earlier requests without reliable dates are not assigned today's date.

| ID | Date | Type | User request | Mapping | Status |
|---|---|---|---|---|---|
| USER-20261004-01 | 2026-10-04 | Decision | DEV is disposable; QA is the user's review environment. QA resets allowed if necessary, preserving/restoring provider configuration and credentials. | Current thread; QA209 | Accepted operating boundary; not a completed provider-export feature |
| USER-20261004-02 | 2026-10-04 | Review request | Compare chat and execution graph; keep tool calls grouped, reveal details without expanding graph nodes. Check architecture component reuse. | ../raports/qa-run-209/report.md | Review recorded; per-call disclosures locally tested, not yet QA-proven |
| USER-20261004-03 | 2026-10-04 | Clarification | DZEV/Jeff means Jev. Check architecture integration and scoped AutoApprove. | ../spec/jev-devin-goal-loop.md | Runtime integration unverified; no explicit Jev profile/schema reference in QA209 |
| USER-20261004-04 | 2026-10-04 | Documentation request | Record user notes with date and classification, so decisions can be traced and mapped later. | This file | Initial record saved; automatic product-wide message archival not implemented |
| USER-20261004-05 | 2026-10-04 | Feature request | User's first prompt defines the goal; later messages may update it. Router receives goal and summaries. Jev reviews Devin's report and continues Devin when the goal is incomplete, finishes when achieved. | ../spec/jev-devin-goal-loop.md | Proposed contract awaiting review; not deployed |

Keep future entries append-only: stable ID, known date/time, source, direct request versus interpretation, linked spec/issue/proof, and actual status. If wording is ambiguous, retain the ambiguity instead of converting it into an accepted requirement. Never store credentials or private tool payloads here.
