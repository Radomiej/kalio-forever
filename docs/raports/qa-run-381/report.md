# QA381 — persisted stale thinking diagnosis and local reattachment fix

2026-10-04. Verdict: UNVERIFIED for closing the actual stale-thinking symptom; local protocol-choice regression passes. Running fixed QA not restarted with this change yet.

## Evidence and decision

Scoped messages endpoint confirmed QA380 assistant LAOXYrCusoJeUNQPLnrL8 has thinking length 3408 under new turn RxO0_1mShVXVEunQ7wonY and prompt DNVBDtetqi4JX3AYkUND9. This excludes a UI-only attribution bug. Prior QA379 assistant had no thinking field. Do not alter historical records to hide the evidence.

Installed ACP SDK is 1.4.0. Host previously preferred session/load over advertised session/resume. Official protocol distinguishes replaying load from no-replay resume: https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/draft/session-setup.mdx . Delayed replay after active prompt registration is a plausible contamination path, not yet proven vendor ordering.

Changed only host restoration preference: advertised resume first; failure propagates without load fallback; load-only agents remain supported with an explicit legacy-fallback comment. Durable history remains owned by Kalio, not imported again for normal reattachment. Advisory review approved the bounded direction but requires live replay/lifecycle proof before closure.

## Acceptance

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| THINK-01 Locate durable contamination boundary | PASS | Backend stored stale thought under QA380 current turn. | Exact ACP delivery timing still unknown. |
| THINK-02 Prefer no-replay reattachment | PASS (local) | Fail-first test exposed session/load with both capabilities. Final restore/host/source suites 23/23 PASS. Both, resume-only, load-only, failure, unsupported cases covered. | No new deployed live run. |
| THINK-03 Compilation | PASS | API typecheck exit 0; Nest build TSC 0 issues, SWC 683 files, exit 0. | Build does not imply running-process upgrade. |
| THINK-04 No stale thought after full QA restart | UNVERIFIED | Not run with this revision. | Repeat QA380 boundary through UI and inspect durable thinking, actual restoration method/capabilities and F5. |
| THINK-05 Late replay and next-turn ownership | UNVERIFIED | Existing host ignores notifications without active turn. | Test delayed replay around restore/prompt completion; resume behavior and load-only limitations remain. |

No broad filtering, deduplication, sleeps, database edits, provider changes or target-project edits. Host remains under 500 LOC. Home Site preview retained; overarching goal active.
