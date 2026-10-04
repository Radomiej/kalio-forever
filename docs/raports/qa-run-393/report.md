# QA393 — Jev integration review for the actual goal loop

2026-10-04. Read-only Git-object review of ede6284b, not a live Jev test or merge. `git merge-base --is-ancestor ede6284b HEAD` returned 1. Decision Settings service is actually in `apps/kalio-api/src/common/decision-settings.service.ts`, not a modules/decision-settings directory. The correct service path is absent in the current checkout (`Test-Path=False`). Earlier directory-oriented absence checks are not by themselves proof of missing integration; correct-path and ancestry checks now confirm this boundary.

## Findings for integration

| Priority | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| P1 | Generic auto-router is not a complete evidence-backed goal judge | State contains task, node and previousEvents only; run input id/prompt, no goal version or AC packet | Reuse existing goal loop with durable original/current goal, acceptance evidence and stale-verdict guard before enabling completion |
| P1 | Goal tail can be silently absent from judge input | sanitizeJevState slices every string to 2000 chars, arrays to 50 entries, depth to 6; oversized state becomes truncatedState string under 12000 chars | Preserve goal/evidence references with explicit bounded summaries; missing evidence must prevent complete, not weaken the goal |
| P2 | Runtime fallback selects default edge regardless of target outcome semantics | Missing credential, low confidence, invalid response and provider errors return defaultEdge.id | For goal-loop schema, default must safely require attention/continuation, never accept an unverified final result |
| P2 | Choice tests are not real Jev + Devin lifecycle proof | Reviewed auto-router specs use mocked resolve/decideChoice, simple prompt and events | Real DEV worker/judge UI run plus Stop/F5/update/approval gates GOAL-01–09 |

## Existing pieces worth retaining

Jev client bounds response to 65536 bytes, times out at 8 seconds, forbids redirects, validates selected choice against offered criteria and confidence in [0,1], propagates caller cancellation. Decision Settings resolves provider/model/credential centrally and validates custom URLs. These are inspected source properties, not current deployed or network-tested claims.

## Review envelope / next integration gate

PROJECT Kalio Forever; REPO current QA-serving worktree; GOAL stable real Devin first and evidence-backed Jev continuation; LINEAR/NOTION mapping not verified here, no external write. CONSTRAINTS no parallel engine, protected @kalio/types require PR review, DEV disposable, preserve QA credentials, manual destructive approvals. ACCEPTANCE docs/spec/jev-devin-goal-loop.md GOAL-01–09. PROOF current deployed Jev absent; reviewed upstream source insufficient for loop acceptance. HANDOFF review protected contract diff/dependencies, integrate on reviewed branch, implement goal packet and guards with fail-first regressions, then prove DEV before QA.

No API keys read or printed. No branch mutation, provider configuration or target-project edit. Overall goal remains active.
