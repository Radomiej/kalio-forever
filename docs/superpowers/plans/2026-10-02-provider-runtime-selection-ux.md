# Provider/runtime selection UX implementation plan

> **Execution note:** Follow `$superpowers:executing-plans` for this plan. Preserve all pre-existing worktree changes; do not reset/stash or stage unrelated paths.

**Goal:** Make connected integrations and execution choices legible, decouple persona identity from provider/model selection, and redeploy the fixed-port QA stack with evidence.

**Architecture:** Backend durable session/run state remains authoritative. Add/extend a validated execution selection at the conversation/run boundary; resolve it once at launch and include it in snapshots. Preserve existing `ExecutionProfile` and persona fields as a recommended default during migration. New chat uses the persona recommendation to preselect a searchable provider/model pair, which the user may override before launch. Frontend controls edit the explicit selection and render backend status only. Settings model catalogs remain dynamic but grouped by connection.

**Tech stack:** NestJS 11, React 19, TypeScript strict, SQLite/Drizzle, Vitest, Playwright, managed stable QA stack.

## Project Context Protocol

- **PROJECT:** Kalio Forever (`RAD-P-4`, project mapping previously confirmed in Notion); current checkout `C:\Users\Radomiej\.codex\worktrees\5a7e\kalio-forever`.
- **GOAL:** Deliver the user-approved provider/runtime and integrations UX direction recorded in `docs/spec/provider-runtime-selection-and-integrations-ux.md`.
- **LINEAR:** Existing work overlaps RAD-100 (Codex integration), RAD-116 (session/provider/runtime selection), and RAD-101 (UX/runtime audit). Reuse/update the matching issue; do not create a duplicate before rechecking current issue relationships/status.
- **REPO:** `AGENTS.md`, `project-spec.md`, backend and frontend tests are authoritative for implementation. User worktree is broadly dirty; preserve unrelated changes.
- **NOTION:** AKS 00–05 and Kalio project mapping were inspected earlier in this task. Accepted decisions include settings-token precedence and capability-gated Devin MCP, and session-scoped stdio bridge. This work must not expose tokens or silently enable native tools.
- **CONSTRAINTS:** No production mutation; no QA database reset; no credential rotation; no Devin/live/paid run before focused tests, API/web typecheck and builds. Stay under 500 LOC per source file; shared contracts require review. Existing tool/permission/HITL boundaries remain intact.
- **ACCEPTANCE:** UX-01 through UX-11 in the linked spec, with explicit legacy-session compatibility and visible effective provider/model.
- **PROOF:** Focused red/green tests, API/web typecheck/build, rebuilt QA at 5288/3316, browser screenshots/interactions in run-25 report, process-count/probe audit where status rechecks change. Devin live proof is separate and only claimed if executed.
- **HANDOFF:** Update the matching Linear issue and append a Notion Agent Note after implementation/QA; read both back. Keep local QA report and session note as source evidence. Do not mark production-ready based on local QA.

## Steps

1. **Reconcile current worktree and contracts.** Inspect dirty diffs, existing user changes, selection/profile APIs, persistence, FE launch flows, and tests. Verify current RAD-100/RAD-116 relationships and spec overlap. Do not edit code yet.
   - Check: scoped status/diffs reviewed; acceptance matrix maps each criterion to owner/API/UI/test; record baseline effective provider and QA stack identity without changing it.
2. **Lock regression coverage (RED).** Add failing tests for persona recommendations plus user override in the provider/model finder, durable conversation/run selection across reload, explicit unavailability/no fallback, legacy persona/session compatibility, grouped models, and token/status feedback.
   - Check: each new test fails for the intended current behavior; no test requires a live Devin credential.
3. **Implement backend contract and persistence.** Treat the persona recommendation as a seed for a new conversation, not dispatch fallback; validate the selected profile/model/credential/capabilities; snapshot effective selection into durable run state before dispatch; return typed pending/ready/blocked/failure status. Maintain legacy read and migration behavior.
   - Check: API/unit tests pass; old fixtures still decode; no secrets appear in DTOs/logs; retries/resumes keep the original run snapshot.
4. **Implement frontend integrations and launch UX.** Group service cards and searchable dynamic catalogs; clarify status/version/permission; persist integration opt-in; unify provider health/default state; remove mock from user choices; put provider/model beside persona at conversation/run launch; implement accessible visible loading/error states.
   - Check: focused component tests and accessibility/browser assertions pass; persona editor no longer owns provider/model selection for new sessions.
5. **Run local gates.** Focused tests, affected API/web typechecks, builds; inspect diff and `git diff --check`.
   - Check: all pass on system Node; any unrelated failures are classified and not “fixed” by weakening tests.
6. **Rebuild and verify stable QA.** Inspect stack scripts/processes and AppData identity first; rebuild/deploy to the existing QA ports without DB/token reset. Browser-test settings, model dialog, connection feedback, project/permission explanation, persona + provider/model selection, launch pending/error/success projections, and reload.
   - Check: UI 200, API health, matching built revision, screenshots/report in `docs/raports/qa-run-25/`; process sampling verifies no repeated CMD churn from UI status polling.
7. **Close evidence and handoff.** Write session note with Mermaid and boundaries, update/read back matching Linear and Notion records, preserve unrelated work, and report any blocked real-Devin or production proof explicitly.
   - Check: local artifacts identify what is implemented, QA-proven, Devin-proven, committed, and deployed separately.

## Required issue ordering

Backend selection and durable contract must land before moving provider controls out of Persona Editor. Grouping/status feedback may proceed as an independent vertical slice if the shared panel/API contract is stable. QA redeploy only after gates pass. Do not claim full goal closure while any core criterion or required proof is BLOCKED.
