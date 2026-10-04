# Jev–Devin goal loop — proposed contract

Source: USER-20261004-03/05 in ../meetings/2026-10-04-user-notes.md. Status: proposal, not implemented or QA-proven. Builds on existing `goal-master-delivery-loop` / `goal_guard_delivery_loop`; do not introduce a parallel lifecycle engine.

## User outcome

The first prompt establishes the goal and acceptance criteria. Later user messages can change scope. Devin executes; Jev judges whether the current goal is fulfilled from observed evidence, not solely Devin's claim. Incomplete work returns to Devin with specific next actions. Completed work terminates the loop and presents a final evidence-based report.

## Roles and context

- Worker: exact Devin execution profile selected for the run, initially swe-2 against approved E:\Projekty\home-site.
- Judge/router: existing Jev Decisions API integration through shared Decision Settings, not a chat execution profile or Devin CLI model. Exact endpoint/model/credential must be validated server-side; no silent mock substitution.
- Reviewer packet: immutable original goal; latest versioned goal and acceptance rows; ordered user scope changes; bounded work summary; worker report; typed tool/build/test evidence; previous judge decision; iteration and budget limits.
- User-reported 32k context is a design constraint to verify for the chosen worker. Reserve space for instructions and output; summarize before overflow rather than using all 32k for history.
- Summaries retain source message/turn references, unresolved requirements, failures and blockers. They must not erase the original goal or silently narrow it.

## Decisions and lifecycle

Use existing typed routing contracts where possible. Required decision semantics:

1. Continue: exact unmet acceptance rows and next worker task.
2. Complete: evidence references satisfying every acceptance row for the latest goal version.
3. Need user/external action: missing authority, credential, unresolved ambiguity or external dependency; no infinite retry.
4. Stop/limit: cancelled or bounded termination, never disguised as completed.

Goal updates invalidate an outstanding judge verdict for an older goal version. Only one worker continuation is admitted at a time. Stop drains worker and descendants. Reconnect/F5 reconstructs the same goal, decisions, iteration and results from backend truth. Approval waits remain durable waits.

## Safety and test configuration

DEV first. AutoApprove must be explicitly scoped to this run, project and allowed non-destructive actions; denied/out-of-scope/destructive actions retain required confirmation. Do not enable global QA auto-approval or change unrelated providers. Judge should use read-only evidence checks and should not spawn unbounded durable reviewers.

## Acceptance

| AC | Required proof |
|---|---|
| GOAL-01 | First prompt creates durable goal and worker task; no provider fallback |
| GOAL-02 | Later user scope update reaches worker and judge; stale verdict cannot finish newer goal |
| GOAL-03 | Deliberately incomplete worker report produces one specific continuation |
| GOAL-04 | Evidence-backed complete report terminates with no extra worker request |
| GOAL-05 | Unsupported success claim, failed build or missing evidence cannot produce completion |
| GOAL-06 | Stop, duplicate decision, F5/reconnect and approval wait preserve lifecycle and scope |
| GOAL-07 | Summarization retains original goal, updates and unresolved acceptance rows within measured context budget |
| GOAL-08 | Scoped AutoApprove permits only approved actions; outside-project and destructive actions do not bypass confirmation |
| GOAL-09 | Real Jev judge and real Devin worker are visible with matching turn/model/tool evidence in Talk and Graph |

## Approach trade-offs and next gate

### Checkout prerequisite discovered on 2026-10-04

Jev HITL and Architect auto_router already exist on `codex/kalio-runtime-installer` at E:\Projekty\kalio-forever (head 19d5c0c2), but not in the current QA-serving worktree branch. Integration commits include 43beadce and ede6284b. Do not rebuild a second Jev client or assume a missing chat model proves missing Jev integration. Resolve branch integration and shared contract review first; no merge/cherry-pick was performed.

The inspected existing auto-router sends task prompt and at most 20 incoming event summaries, each message truncated to 500 characters, to a choice decision. It does not yet prove preservation of the full versioned goal/update/evidence packet required here. A Jev choice/confidence is a routing signal, not an independently generated work report. Runtime completion must still enforce evidence and goal-version guards. Keep the exactly-one-default edge fallback safe (need attention, not unverified completion).

Recommended: configure a two-role variant of the existing Goal Master loop. This reuses durable execution, Stop and graph projections. A manual coordinator is useful only as a diagnostic probe and does not satisfy automatic continuation. A separate goal engine duplicates lifecycle ownership and is not proposed.

Before implementation: review this contract, inspect current role/profile resolution and AutoApprove enforcement, locate an available Jev provider, then prepare the concrete implementation/test plan. No live Jev run has been performed for this proposal.
