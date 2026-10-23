# Goal runtime activation — remaining acceptance gates

Target: a real Devin `swe-2` run started through Kalio QA against `E:\Projekty\home-site`, using approved Kalio tools, followed by trustworthy Jev continuation or completion. Local helper tests do not close this target.

Current source boundary, inspected 2026-10-07: runtime injects `GOAL_ROUTE_RESUME` but its production host authority is not registered. Goal admission writes a required goal-state ACK, not a launch/readmission authorization record. Graph node lifecycle currently uses best-effort telemetry. Host BUILD and aggregate verification are under implementation, not activated.

| AC | Required outcome | Evidence required | Current status |
| --- | --- | --- | --- |
| AC-01 | Real canonical launch/readmission authority | Dispatcher-owned source identity, durable authorization, explicit predecessor and Stop references | UNVERIFIED |
| AC-02 | Durable current node visit | Required start ACK before execution; completed ACK before queue/count advancement; exact resumed start identity | UNVERIFIED |
| AC-03 | BUILD through Kalio tools | Real journal/message/result linkage, human-only spawn approval, owned terminal polling, exact exit status, no restart respawn | UNVERIFIED |
| AC-04 | Complete durable aggregate verification | All immutable worker/BUILD leaves, failed attempts, dispatch/HITL origin and current scope verified at authorization and replay | UNVERIFIED |
| AC-05 | Safe terminal publication | Current receipt, required terminal ACK, Stop barrier, synchronous publication with tied terminal visit | UNVERIFIED |
| AC-06 | Real QA consumer workflow | Browser launch, tool-origin display, approval, result, graph/chat parity, Stop/follow-up and F5 recovery | UNVERIFIED |
| AC-07 | Preserve QA configuration | Exact fixed QA data root, retained provider credentials/settings, effective request-scoped Devin model | PARTIAL: existing QA healthy; no new deployment proof |

Ordering decision: keep the existing required route ACK before the completed visit record that references it. Await completed visit ACK before advancing counts/queue. Artifact completion belongs to the terminal checkpoint before synchronous publication; neither an independent early `done` nor a post-publication ACK is acceptable.

Opaque checkpoint IDs must never be parsed for authority. Goal-state ACK, timestamps, model prose and a diagnostic cursor are not launch/readmission or BUILD proof. Missing/pruned/conflicting records must reject recovery, not choose graph roots or respawn a terminal.

Implementation ownership: chat-owned BUILD adapter; architecture-owned aggregate verifier and route-authority decoder; graph-owned required visit hooks; parent-owned production assembly and QA browser proof. Do not register synthetic/default authorities to make local gates green. Do not manually edit HomeSite to substitute for Devin execution.

### AC-01 concrete launch boundary (2026-10-08)

Read-only inspection identified the actual insertion point: `ToolDispatchService` invokes its captured registry executor after entry acknowledgement; `RunSubAgentFlowTool` propagates the parent call and trusted source identity to the AgentFlow adapter. Canonical goal admission currently persists goal state, not a launch authorization/admission pair. The closed atomic SQLite pair writer now exists in `chat/goal-launch-pair-writer.ts`; it is not yet connected to a dispatcher-owned producer.

Implementation must first supply the real synchronous pair transaction and reject generic insertion of its two reserved labels (`architecture_event:goal_launch_authorization`, `architecture_event:goal_route_admission`). A subsequent dispatcher-owned private capability must bind actual executor entry, persisted parent source, approval and one allocated child; model arguments, resolved-only callbacks and generic audit rows cannot mint that authority. Keep producer origin distinct from saved-byte hashes. Required proof includes real dispatcher composition, SQLite close/reopen, foreign scope, Stop, conflicting retry and rollback of a failed second insert. Writer and producer work are in progress; none of this is deployed or QA-proven.

Storage evidence (2026-10-08 01:26 Europe/Warsaw): parent independently ran writer and audit-proof specs with system Node outside sandbox; 73/73 passed, exit 0. A subsequent API `tsc --noEmit` exited 0. The writer atomically persists/read-backs the pair and generic audit insertion rejects the exact reserved labels. This proves storage only. Its per-capability WeakMap does not prevent a recreated producer from launching another child. Durable parent-call reservation and retention/recovery policy remain required before activation.

Persistence-order boundary fixed locally: `createRuntimeToolDispatcher` now awaits assistant/tool-call persistence for `run_sub_agentflow` even without native options, preserves the once-transformed descriptor without duplicating the collected call, and rejects launch after Stop during the write. Non-launch/no-options timing remains unchanged. `readActiveLaunchCallExact` now verifies exact active journal revision/phase and persisted prompt/assistant/call linkage. Neither primitive independently proves executor entry or approval origin.

Fresh parent gate 2026-10-08 01:33 Europe/Warsaw: launch-order spec 7 + active-reader spec 61 + atomic-writer spec 24 = 92/92 PASS, system Node outside sandbox, exit 0. Launch-order fixtures use real SessionManager/SQLite message repository. Durable child reservation, private dispatcher capability and admission assembly remain unimplemented; this is not QA launch proof.

Reservation backing now implemented locally: additive migration `0038_goal_launch_reservations.sql`, operational table independent of audit retention, composite exact parent-call key, immutable occupied rows, parent-journal `ON DELETE RESTRICT`, immediate reservation transaction and no deletion API. Descriptor stores noncontent fields and source/argument/flow/schema digests, not conversation text. Fresh parent gate 2026-10-08 01:42: reservation 24 + reader 61 + writer 24 + launch ordering 7 = 116/116 PASS on real SQLite fixtures. Writer-to-reservation binding is the next integration; no fixed-QA migration/deployment occurred.

Prelaunch approval remains separate from post-result evidence. Existing gateway-owned `approvalOrigin` and `claimApprovedHostContinuation` establish the terminal-spawn human-only path before execution; existing `readHitlExact` requires a result commit and must not be reused as a launch issuer. Extending launch approval requires independently verified claimed-state linkage, immutable eligible schema/flow/policy snapshot and visible Goal Protocol disclosure. Current terminal-only requirements and legacy approvals do not automatically authorize goal launch.

### AC-06 Stop cancellation persistence: explicit remaining states (2026-10-08)

| State | Required outcome | Current evidence |
| --- | --- | --- |
| Stop after resolution, before executor | Zero execution; cancelled result and exact cancellation receipt | Local composed dispatcher/recorder/SQLite regression passes with actual reservation-issued bounded lease; QA unverified |
| Claimed HITL cancellation before resolution | Preserve actual HITL commit; no invented canonical name/entry | Dedicated 16-test local regression suite passed; exact claimed commit is independently read back; QA unverified |
| Stop after real executor entry | Retain actual entry and cancellation result; no new execution | Local composed cancellation suite passes; no normal observer commit/completion; QA unverified |
| Expired/hanging cancellation reader | No retry or late insert; explicit drain failure | Host capability and recorder regression suites passed; bounded lease revokes on expiry/release; QA unverified |
| Parent/child reservation release | Stop awaits cancellation recording settlement before releasing owner | Actual reservation and observed-subagent owners wired; local owner/service regressions pass; QA unverified |
| Completion after Stop | No producer seal, completed relabel, BUILD proof or authorization | Entry guard prevents observed-subagent output copying after Stop; host BUILD post-commit abort regression passes; architecture BUILD cancellation ownership still incomplete |

Cancellation-only persistence must use a mandatory independent bounded host lease issued by the actual reservation/subagent Stop owner. Generic abort, model JSON, caller booleans and signal reason are not Stop authority. Normal execution signal/producer guards remain intact. A green test that explicitly expects receipt rejection documents this gap; it does not close AC-06.

Fresh scoped verification 2026-10-08 01:20 Europe/Warsaw: system Node, API workspace, `pnpm exec vitest run src/modules/chat/llm-turn-cancellation-recording.spec.ts src/modules/chat/subagent-completion-stop.spec.ts src/modules/chat/subagent-cancellation-recording.spec.ts --maxWorkers=2` exited 0, 17/17 tests passed. This is local integration/fixture evidence, not a live Devin run or QA deployment. AC-01–07 remain open at their full workflow scope.

Fresh fixed-QA static readiness recheck (2026-10-08): outside the sandbox, exact approved session/project and `swe-2` profile pass; bridge enabled, native filesystem/terminal disabled, six approved tools and confirmation flags pass, one existing online host and no unresolved run/child pass. Exit 1 is solely the protected `/hitl/config` read and dependent manual-HITL check. No prompt, approval, reset or deployment occurred. An initial sandbox probe failed socket permissions; it is not evidence of a QA outage.

### Protected launch disclosure acceptance boundary (2026-10-08)

The read-only consumer map identifies three actual approval owners: inline chat/delegated timeline, Execution Graph inspector and Home/global inbox. Socket ingestion preserves the complete pending request, but durable persistence and pending-request reconstruction must explicitly retain any approved disclosure contract. Current clients declare no disclosure capability. Shared contract review is pending; do not activate protected launch based on schema names, model arguments or generic approval.

| Acceptance | Required proof | Current status |
| --- | --- | --- |
| Persist before display | Exact immutable host-approved disclosure and private binding survive SQLite restart | Unimplemented |
| Hydration parity | Initial delivery, F5, reconnect and delegated replay expose the same disclosure | Unimplemented |
| Approval surfaces | All three owners render disclosure and fail closed for malformed/unknown protected versions; cancel remains available | Unimplemented |
| Compatibility | Older clients cannot blindly approve protected launch; legacy non-goal approvals remain unchanged | Contract review pending |
| Authority | Approval command and tool args unchanged; claimed-state reader validates host snapshot, not client assertions | Unimplemented |

Current parent revalidation: runtime/barrier 127/127 tests PASS, system Node outside sandbox, exit 0. Cancelled goal Stop ACK retry after drain and async/thenable rejection are present in current source. These local fixes do not close the launch or real QA acceptance rows. Read-only environment check reports no valid control-plane token in process or user environment; no token value was printed and no settings changed.

Architecture advisory reviewed the disclosure proposal. The consumer semantics must say `attempt_goal_continuation_until_review_or_blocked`, not guarantee uninterrupted continuation; the approval boundary must say `confirmation_required_actions_remain_independent`, not claim every subsequent action needs approval. Proposed V1 fields are schemaVersion, kind, preset id/name snapshot, exact goal, behavior, approvalBoundary and opaque disclosureId. Arguments and approval command remain unchanged. No shared contract edits are authorized by this advisory until capability ACK, cross-session inbox authorization, rejection recovery and existing bounds are inspected.

The earlier socket-capability proposal is superseded by the exact browser-only HTTP decision boundary in `docs/spec/jev-devin-goal-loop.md`. Session subscription or a client capability ACK is not approval authority. The reviewed route is `PUT /api/hitl/goal-launch/decision`; it uses the server-issued local browser capability, rejects bearer authority and writes a distinct browser decision origin. No socket ticket or synthetic gateway identity is required or permitted.

Unknown versions with a valid disclosure envelope can be rejected through the authenticated route; corrupted envelopes require explicit future administrative cleanup, not a fabricated cancel fallback. Existing unmarked requests remain legacy without backfill. Initial delivery and replay must use the exact persisted disclosure, not current registry state. All three approval owners must retain or restore requests after server rejection. Production launch activation remains disabled until producer, alternative-channel guards, claim, execution and consumer evidence pass.

### Current local composition checkpoint (2026-10-08 02:58)

The private disclosure/requirement/origin parsers, paused-source verifier, atomic decision writer and live-wait reconciliation are implemented locally. Parent independently verified 122 tests including actual cookie authorization and decision-service SQLite writes composed with waiter settlement. The fresh user-only host-policy reader and explicit schema/alias publications are also implemented and separately tested. These are not wired controller/producer/claim or real QA proof; AC-01–07 retain their full workflow scope.

The pending projection now hides protected goal rows from ordinary confirmations while preserving raw pending rows for Stop cleanup. A dedicated protected projection and all three FE disclosure renderers remain unimplemented. The current-snapshot adapter is implemented and locally verified (130 combined owner/decision/publication tests), but production composition is not wired; no host allowlist was configured, and no provider configuration or fixed-QA data was changed.

### Preparation and browser access checkpoint (2026-10-08)

Source inspection establishes that the normal journal-backed caller invokes `onToolPending` before dispatch, so its expected preparation state is `active / tool_pending`; waiting changes it to `waiting_for_human / tool_pending`, and approved execution changes it to `active / tool_running`. This is source ordering, not yet a composed observation or concurrency guarantee. A dedicated test-only real-SQLite observation is authorized and in progress. Do not infer the exact revision from callback completion, fabricate a `tool_running` preparation checkpoint, or broaden the existing post-approval active-call reader.

Fixed-QA browser HITL access now passes after refreshing a stale loaded document from `index-BZduck-n.js` to the currently served `index-Ccrg_B54.js`. No deployment/settings write was required. The independent script preflight still cannot read protected HITL configuration without authorized control-plane access; all remaining exact Devin session/profile/path/tool/host/children checks pass. Browser cookies are not extracted to substitute for that access.

### Stop authority advisory disposition (2026-10-08)

Independent gpt-5.6-sol/xhigh review recommends one private neutral owner/validator binding, short-lived finalization permits, retained failed Stop fences, explicit retries and permanently revoked old permits. No-active cleanup must remain supported. This is design advice, not implemented authority or runtime proof. Retaining a failed fence is an intentional lifecycle change, not behavior-neutral; preserve the existing synchronous abort after fence installation rather than deferring cancellation behind asynchronous queue cleanup.

Protected cancellation activation additionally requires atomic durable cancellation/receipt backing, restart reconstruction of unfinished Stop fences, and proven idempotent tool-result/journal destinations. A pending-only scan cannot recover a cancelled row whose subsequent persistence failed. Do not add an outbox before proving destination idempotency or claim process-local permits survive restart. A bounded read-only inspection of those destinations is the next step; no module/guard activation is authorized by this checkpoint.

First ordinary-cancellation fix is authorized as a pending-only SQLite transaction: request CAS, exact tool-result insertion and scoped journal CAS commit together or roll back together. It must reject protected goal families before any mutation and preserve ordinary legacy cases with neither run nor turn; partial contradictory linkage conflicts. Missing prompt remains SQL NULL rather than fabricated message identity. No `already_committed` authority, transaction-origin marker, outbox or new migration is included. Commit/response-loss provenance and protected Stop/restart recovery remain open, not inferred from cancelled status. Required evidence is actual ChatService consumer failure injection/rollback/retry with the production unique index and exact source/journal conflict tests.
