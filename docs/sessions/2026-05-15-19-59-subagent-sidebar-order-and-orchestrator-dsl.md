# Subagent Sidebar Order And Orchestrator DSL Check

## What was done

- Reproduced the reported subagent ordering issue live in Playwright MCP.
- Verified that child chat transcripts were already rendering in chronological `user -> agent` order.
- Identified the actual ordering bug in the left Conversations sidebar: sibling subagent sessions under the same master chat were sorted by `updatedAt`, which put newer children above older siblings.
- Added a frontend regression test for sibling subagent ordering in `SessionPanel.test.tsx`.
- Changed `SessionPanel.tsx` so grouped sibling subagent sessions keep creation order (`createdAt` asc, stable `id` tiebreak) while root groups still sort by recent activity.
- Extended the deterministic Playwright spec `apps/e2e/tests/regression-chat-ordering-canvas-preview.spec.ts` to assert the left sidebar order as well.
- Ran a live Playwright MCP scenario with the Orchestrator persona for a Tic-Tac-Toe RA-App in DSL/ECS, not HTML.
- Observed that Orchestrator selected `RaBuilder` and delegated via `run_subagent` on the draft-first DSL path, but it still mixed in HTML/design-preview guidance.
- Added a backend persona regression test for the Orchestrator prompt and refined `apps/kalio-api/src/assets/personas.json` so RA-App DSL/ECS tasks explicitly stay on `raapp_create_draft -> raapp_execute_dsl -> raapp_test/publish` and do not ask for HTML/design_preview unless the user explicitly wants an HTML prototype.

## Files touched

- `apps/kalio-web/src/features/sessions/SessionPanel.tsx`
- `apps/kalio-web/src/features/sessions/SessionPanel.test.tsx`
- `apps/e2e/tests/regression-chat-ordering-canvas-preview.spec.ts`
- `apps/kalio-api/src/assets/personas.json`
- `apps/kalio-api/src/modules/persona/persona.service.spec.ts`
- `docs/sessions/2026-05-15-19-59-subagent-sidebar-order-and-orchestrator-dsl.md`

## Key findings

- The user-visible reversed order bug was not in `ChatInterface` child transcript rendering.
- The bug was in sidebar grouping/sorting for sibling subagent sessions.
- `createdAt` is the right ordering signal for sibling subagents; `updatedAt` causes jumps when a newer child remains more active.
- The Orchestrator and RaBuilder personas are broadly aligned for DSL/ECS RA-App work, but Orchestrator needed a stronger rule to avoid leaking HTML/design-preview instructions into pure DSL delegations.

## Validation

- `pnpm --filter kalio-web exec vitest run src/features/sessions/SessionPanel.test.tsx` -> passed (`20` tests)
- `cd apps/e2e; pnpm exec playwright test tests/regression-chat-ordering-canvas-preview.spec.ts --project=chromium` -> passed (`1` test)
- `pnpm --filter kalio-api exec vitest run src/modules/persona/persona.service.spec.ts` -> passed (`27` tests)
- Live Playwright MCP verification after the sidebar fix showed the left sidebar order as:
  - master chat
  - older child `Sub-agent: Stwórz prostą...`
  - newer child `Sub-agent: Plik game/tic-tac...`
- Live Playwright MCP Orchestrator run showed:
  - Orchestrator found `RaBuilder`
  - delegated through `run_subagent`
  - child transcript started with `systems.yml` + `ui.gui` draft-first intent rather than raw HTML generation

## Open questions

- The live Orchestrator run was inspected mid-flow and confirmed the DSL delegation path, but the full end-to-end RA-App publish/render completion was not followed to final completion in this slice.

## Next steps

- If needed, add a dedicated Playwright E2E around the Orchestrator -> RaBuilder DSL RA-App delegation path once the desired end-state for the published preview is stable enough for deterministic assertions.