# Central subagent approvals

## What was done
- Investigated the HITL friction where master-driven subagent work required jumping into child sessions just to approve pending tools.
- Added backend replay of pending `tool:confirmation_required` payloads on `session:identify`, so reconnects and HMR no longer orphan pending approvals.
- Changed frontend confirmation handling to match pending confirmations by `toolCallId`, not only by the current active session.
- Updated the live `run_subagent` bubble to surface descendant child tool activities from the master view by filtering activities with `agentRun.parentToolCallId === run_subagent.callId`.
- Auto-expanded the master `run_subagent` bubble when child activity appears so pending approvals are visible immediately instead of being hidden behind a collapsed chip.
- Added frontend regressions for cross-session confirm/cancel from the master view and for nested child approvals inside the live `run_subagent` bubble.
- Added a backend regression proving `session:identify` must replay pending confirmations for that session.
- Live-retested Orchestrator -> UX Designer delegation in Playwright MCP: the child `image_generate` approval appeared centrally inside the master `run_subagent` bubble, and confirming from the master view triggered the child tool execution.

## Files touched
- `apps/kalio-api/src/modules/chat/tool-dispatch.service.ts`
- `apps/kalio-api/src/modules/chat/chat.gateway.ts`
- `apps/kalio-api/src/modules/chat/__tests__/chat.gateway.spec.ts`
- `apps/kalio-web/src/features/chat/ToolCallBubble.tsx`
- `apps/kalio-web/src/features/chat/ToolCallBubble.spec.tsx`
- `docs/sessions/2026-05-11-20-11-central-subagent-approvals.md`

## Decisions
- Chose centralized explicit approvals in the master bubble over blanket auto-approve. This matches multi-agent HITL best practice for costly or mutating tools.
- Kept routing simple and local: child activities are grouped under the parent `run_subagent` call via existing `agentRun.parentToolCallId`, instead of introducing a second approval state model.
- Replayed pending confirmations on reconnect rather than polling for approval state or forcing the user into the child session.
- Scoped the frontend change to live tool bubbles only; completed child outputs remain handled by the existing `run_subagent` history/result flow.

## External confirmation
- Perplexity summary aligned on the same UX direction: keep approvals centralized in the master session, reserve auto-approve for explicitly safe low-risk actions only, and preserve one-click approve/reject controls inline with the parent workflow.

## Validation
- `cd apps/kalio-web; pnpm vitest run src/features/chat/ToolCallBubble.spec.tsx`
- `cd apps/kalio-web; pnpm vitest run src/features/chat/ToolCallBubble.test.tsx`
- `cd apps/kalio-api; pnpm vitest run src/modules/chat/__tests__/chat.gateway.spec.ts`
- `cd apps/kalio-web; pnpm exec tsc --noEmit`
- Playwright MCP live retest on a fresh Orchestrator session confirmed:
  - master turn rendered `run_subagent`
  - nested child `image_generate` appeared under `SUB-AGENT ACTIVITY`
  - `Confirm` / `Cancel` were visible in the master bubble
  - confirming from the master bubble triggered child tool execution without opening the child session

## Open follow-up
- The live child `image_generate` request still failed downstream with `Image generation failed: invalid character '<' looking for beginning of value`, then retried and requested approval again. That is a separate provider/runtime issue after the approval UX path, not a regression in the new centralized subagent approval flow.
- If needed later, add a scoped auto-approve setting only for explicitly safe child tools; do not blanket-auto-approve all subagent actions.