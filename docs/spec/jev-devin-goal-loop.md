# Jev–Devin goal loop — proposed contract

Source: USER-20261004-03/05 in ../meetings/2026-10-04-user-notes.md. Status: partially integrated; the complete versioned goal loop is not QA-proven. Builds on existing `goal-master-delivery-loop` / `goal_guard_delivery_loop`; do not introduce a parallel lifecycle engine.

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

### Revalidated QA-serving checkout — QA384

At HEAD 6deadade, both integration commits above are not ancestors of the QA-serving branch. The Jev client, Decision Settings module and architecture auto-routing service are absent at their expected paths. Existing judge-guard regression is 3/3 PASS but does not prove a real Jev run. GOAL-01 through GOAL-09 remain unverified; see ../raports/qa-run-384/report.md. Integration includes protected @kalio/types changes and must pass the repository shared-contract review gate before deployment.

### Current worktree revalidation — 2026-10-07

The QA384 paragraph above records a historical checkout, not the current implementation. The current `codex/kalio-provider-runtime-ux` worktree contains `common/jev-decisions.client.ts`, Decision Settings, HITL Jev, and `modules/architecture/architecture-auto-routing.service.ts`. Shared-contract review remains a release requirement; presence of these files is not merge or live-loop proof.

The current `ArchitectureAutoRoutingService.choose()` resolves Decision Settings and sends the original run prompt plus at most 20 incoming event summaries, each message bounded to 500 characters. It does not provide an explicit versioned goal/update/acceptance/evidence packet. Consequently, router integration alone cannot close GOAL-02 or GOAL-07, nor prove the whole GOAL-01–09 workflow.

Fixed QA remains on 3316/5288 with preserved provider settings. A real SWE-2 read and build have separate recorded evidence in QA493/494. QA495 exposed a readiness consumer regression: the newly protected HITL config read is rejected by the unauthenticated CLI preflight. Do not remove its guard or bypass the failed preflight to claim live readiness. Fix the authenticated read, then verify exact-host resume versus cold-start admission and the complete browser-started goal loop.

### Decisions-model capability boundary — 2026-10-07

The existing Jev client supports typed choice and yes/no probability results, not generated prose, arbitrary acceptance-criteria extraction, evidence references, or a free-form continuation report. OpenRouter's [official Decisions tutorial](https://openrouter.ai/blog/tutorials/how-to-use-jev/) confirms that several independent typed questions may be evaluated in one request and that application code owns control flow. Do not implement an imaginary report-generation API or treat confidence as execution evidence.

The existing runtime should own the versioned original goal, ordered source-linked updates, evidence ledger and candidate continuations. Jev evaluates semantic acceptance questions against that state; deterministic host validation checks current goal/evidence/policy bindings, required build success, evidence provenance and unresolved children before completion. Acceptance extraction from ordinary user prose requires an existing worker/parser phase with validation; it is not a capability of the current Jev Decisions client.

Compatibility invariant for the planned additive contract: packetless legacy runs retain existing behavior. A goal-directed run cannot reuse a checkpoint or verdict without exact current goal-version, goal-fingerprint, evidence-fingerprint and policy-fingerprint matches. Missing or mismatched bindings must not complete the run. Old runs must not be silently promoted without trustworthy source message IDs.

Implementation status: typed-evidence projection and batch yes/no transport are locally implemented and unit-verified, not deployed/live-loop proof. Canonical source creation, SQLite goal-state CAS, metadata-only required audit, source-backed start/resume admission, semantic projection review and projection transaction services now exist locally. Durable completion authorization, two-role graph activation and full GOAL-01–09 integration remain incomplete/unverified. QA496 proved a real Devin terminal preview/manual approval/F5 workflow, not this automatic loop.

### Reviewed additive packet contract — 2026-10-07

The local shared `architecture-goal.ts` contract separates untrusted worker criteria proposals from host-accepted snapshots. A pending projection retains the last accepted base but cannot complete the run. Source updates are ordered, versioned, and source-linked; canonical source content must come from persisted user messages, with role/session/turn checked before mutation. Locator IDs propagated by a tool are not sufficient proof by themselves.

Completion evidence policy is host-owned and cannot be supplied or weakened by a worker proposal. Quote references derive source identity without a duplicate source-ID array. Historical accepted criteria remain retained when superseded. Goal, evidence and policy bindings invalidate old decisions independently.

Canonical source timestamps use the existing `Timestamp` type. Durable sources are not sanitized/truncated in place; per-request disclosure separately records raw/sanitized/omitted transport. An omitted or sanitized essential source cannot justify completion. Over-budget essential source sets block the decision rather than silently narrowing the goal.

The shared types build passed locally. This is a contract declaration, not runtime activation, migration or GoalPacket persistence proof. Legacy runs have no packet and retain existing behavior. Implementation PR review remains required before merge; full real Devin/Jev lifecycle proof remains required before release.

### Existing-graph integration decision — 2026-10-07

Use two executable roles within the existing graph lifecycle: Devin worker and Jev judge. The host owns terminal publication. A phase adapter may derive the current phase from canonical goal state, but must not own a second run loop, child lifecycle, stop queue, status map or persistence engine.

Pending projection first executes a strict worker proposal through the existing RoleExecutor/SubagentRuntime. Its host-only execution contract excludes writes, terminal execution and delegation by intersecting tool permissions; prompt wording alone is insufficient. Since the scheduler executes ready nodes concurrently, the entire batch must exclude implementation while projection is pending. Worker JSON supplies criteria/source quotes, never host IDs, evidence policy or acceptance authority.

The judge reviews completeness, scope and supersession independently at probability >=0.95. Accepted CAS plus required audit acknowledgement permits implementation. Rejection/uncertainty is not completion. A new human source update invalidates old proposal/review and redirects to proposal before further work.

Completion uses exact host-owned candidates `continue:<active criterion ID>` and, only when deterministic evidence admission permits it, `complete`. Goal routing must not use the generic default-edge fallback. A valid Jev choice remains insufficient without current source/goal/evidence/policy bindings, current-run evidence provenance, required build success and resolved children. Persisted authorization without its required checkpoint is awaiting finalization, not completed.

Local module tests/typecheck/build are recorded in QA501; no real two-role trace, completion receipt, restart/F5 or deployment proof is claimed by this decision.

### Protected launch decision authority — 2026-10-08

Goal-launch approval must use a separately reviewed, exact HTTP decision route through the allowlisted frontend `/api` proxy. Existing DecisionAuth browser-cookie authority proves a valid server-issued local-origin browser capability, not named-user identity, session ACL ownership or biological human presence. Bearer automation authority cannot satisfy the interactive browser-only launch policy. Existing Socket.IO subscriptions are delivery state, not launch authority; do not mint a synthetic gateway origin or socket identity for HTTP decisions.

The protected route must require PUT, JSON, the raw loopback peer, explicit exact browser Origin/Host and a valid unexpired browser cookie, rejecting bearer headers even alongside that cookie. Its request selects the persisted request/session/disclosure and decision; it must not accept tool arguments, hashes, registry identity, origin data or socket/capability assertions. A distinct server-authored approval-origin variant binds the exact persisted disclosure and claimed revision; its schema and the literal route remain subject to review before implementation.

Protected goal requests must fail closed in legacy socket, Telegram, generic resolution, Jev and durable ChatService fallback approval paths. Existing terminal-spawn gateway origin and unmarked requests remain compatible. Both approve and reject use authenticated HTTP for protected requests; unsupported disclosure versions cannot approve, but must not trap the user without an authenticated rejection path. The endpoint records a decision only: it must not allocate child sessions, reservations or invoke an executor.

Initial display and reconnect replay use immutable persisted disclosure, never a fresh registry projection. All three approval owners must render it before approval. On cookie expiry, use browser reauthentication without socket fallback; on stale decision, refresh durable pending state. Capability/version declarations may express rendering support but grant no authorization. Runtime activation remains disabled until persistence, alternate-channel rejection, actual prelaunch claim, reservation, Stop and terminal/recovery integration are proven.

Reviewed literal decision route: `PUT /api/hitl/goal-launch/decision`, using a separate browser-only guard without widening existing configuration routes. Text bounds use Unicode code points, rejecting lone UTF-16 surrogates. IDs/names must already equal their trimmed values; goals/messages are preserved exactly. Disclosure IDs use host-only default `nanoid()` and the exact 21-character `[A-Za-z0-9_-]` format. Private approval snapshots require an explicit stable `policyId` alongside the policy hash.

Goal-launch canonical JSON is isolated from legacy hashes: recursively order own enumerable data-property object keys with the ordinal UTF-16 comparator `a < b ? -1 : a > b ? 1 : 0`, preserve dense-array order, serialize with JSON.stringify and hash UTF-8 bytes to lowercase SHA-256. Plain and null-prototype objects are accepted. Undefined, nonfinite numbers, negative zero, functions, symbols, bigint, proxies, accessors, custom prototypes/toJSON, cycles, sparse arrays, extra array properties and lone surrogates are rejected. Integer-like object keys follow JSON.stringify's specified enumeration after ordering; fixed byte/hash fixtures are required. Legacy completion/receipt hashes are not changed in this slice.

Disclosure parsing has a safe base envelope (positive safe-integer schemaVersion and exact disclosureId) followed by strict V1 parsing for approval. Unknown versions with a valid envelope may be authenticated and rejected without current definition/source/eligibility checks. Corrupted records without a valid envelope cannot use normal decision actions: display “This approval record is damaged; administrator cleanup is required.” Administrative cleanup is not implemented and must not be implied available. The current-snapshot port is mandatory for approval, with no optional/default-allow composition; its absence, failure or mismatch prevents mutation.

The finalized private requirement also binds `parentWaitingRevision`, captured from the actual committed `waiting_for_human / tool_pending` checkpoint. HTTP approval verifies that exact paused source in the decision transaction; it does not reuse or broaden the `active / tool_running` executor-launch reader. Revision arithmetic, newer-revision acceptance and chronological message reconstruction are forbidden.

Producer lifecycle is prepare → persist protected but non-approvable request → commit waiting checkpoint → read exact paused revision → CAS finalize approval-ready requirement → emit. `listPending` must not expose preparing rows as ordinary approvable confirmations. Recovery may finalize only after verifying the actual paused source; missing/invalid source stays blocked without legacy downgrade.

Current-definition/policy checks may await outside the SQLite transaction. The transaction then reloads and compares the exact request revision/requirement/disclosure, verifies paused source synchronously and performs the decision CAS plus origin write. No external asynchronous call belongs inside the transaction. Approval records the observed snapshot, not perpetual eligibility: claim and launch must independently reject subsequent definition/policy drift. Rejection requires neither source nor current-definition checks.

### Definition and host-policy publication review — 2026-10-08

The current flow runtime resolves aliases to architecture schemas; it does not own a separate executable flow definition. Publish this relationship truthfully as `{schemaVersion:1, kind:'schema_alias', flowDefinitionId, schemaId, schemaDefinitionSha256}`. Hash the complete alias record, not a copied schema. Equal alias/schema IDs do not collapse their distinct roles.

### Execution identity and consolidation — 2026-10-08

There is one architecture runtime, not old/new independent AgentFlow engines. Keep aliases and durable recovery consumers until a replacement demonstrates equivalent launch, continuation, Stop and reconnect behavior. Remove actual orphaned code only after that inventory; do not equate compatibility names with resource leaks.

Architecture launches may carry an explicit `executionProfileId`, validated through the existing enabled-profile owner before any root or branch allocation. Standalone roots persist it; ordinary child sessions inherit their parent identity. A parent/profile conflict fails closed rather than silently selecting an API provider. This is identity selection, not launch authorization or model-availability proof.

The intended mixed-provider role configuration must bind persisted profile identities, not bare model names. A role that changes provider needs a host-owned child-launch authorization tied to the actual parent turn, run, node/attempt, project and chosen profile. Do not relax ordinary child inheritance or use an untrusted context boolean to authorize that switch. New Chat must display the selected profile and architecture overrides and preserve them through launch/reconnect. This complete mixed-provider goal workflow is not yet proven or activated by the root-selector change.

The schema owner publishes `{schemaVersion:1, kind:'goal_schema', schemaId, definition}` using an explicit exhaustive field mapper. Preserve all actual schema semantics and array order. Omit undefined only at declared optional fields; reject required/dynamic undefined and other non-JSON values. Keep legacy schema cloning unchanged. The publication is not graph-topology validation or launch authority.

Host policy comes from a fresh user-only `.kalio/config.toml` read by the existing configuration owner, never merged project configuration or the effective-config cache. The optional `[goal_launch_policy]` input contains `enabled`, explicit stable `policyId` and `allowedBindings`. No default ID, autogenerated policy, inferred eligibility or configuration-file mutation is part of implementation.

An active policy publishes `{schemaVersion:1, kind:'goal_launch_policy', policyId, selection:'explicit_allowlist', approvalAuthority:'decision_browser_goal_launch', behavior:'attempt_goal_continuation_until_review_or_blocked', approvalBoundary:'confirmation_required_actions_remain_independent', eligibleDefinitions}`. Each binding pins flow/schema identities and both publication hashes. Sort the detached binding set by its complete ordinal identity/hash tuple; reject exact duplicates. The host-config limit is 1–64 bindings. Missing/disabled policy is ineligible; malformed active policy fails closed. Browser capability is not biological-human identity.

Producer and current-snapshot readers must consume the same owner publications and independently verify their hashes and exact policy allowlist relationship. No HITL-to-Architecture module cycle, executor service-locator definition authority or permissive fixture/default provider is allowed. These reviewed publications do not activate a producer, authorize a child, or close real Devin QA.
