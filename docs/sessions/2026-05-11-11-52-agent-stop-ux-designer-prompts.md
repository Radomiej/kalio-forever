# Agent stop + UX Designer prompts

## What was done
- Added backend regression coverage for child-session stop ownership in `ChatGateway`.
- Added backend regression coverage for cascading `chat:stop` from a master session to child subagent sessions.
- Fixed `ChatGateway` so the initiating socket is automatically subscribed to child session ids as soon as child events are emitted.
- Added `SessionsService.listChildren()` and made `chat:stop` cascade through descendant subagent sessions.
- Reworked the seeded `designer` persona prompt to use exact tool names (`vfs_list`, `vfs_read`, `vfs_write`, `design_preview`, `raapp_create`), remove the rigid dark two-page template, and align with the repo's frontend design guidance.
- Added a safe seeded-prompt refresh path in `PersonaService` that upgrades the stored UX Designer prompt only when the DB still contains the old rigid designer template, while preserving customized prompts.

## Files touched
- `apps/kalio-api/src/modules/chat/chat.gateway.ts`
- `apps/kalio-api/src/modules/chat/sessions.service.ts`
- `apps/kalio-api/src/modules/chat/__tests__/chat.gateway.spec.ts`
- `apps/kalio-api/src/modules/persona/persona.service.ts`
- `apps/kalio-api/src/modules/persona/persona.service.spec.ts`
- `apps/kalio-api/src/assets/personas.json`

## Validation
- `pnpm vitest run src/modules/chat/__tests__/chat.gateway.spec.ts src/modules/persona/persona.service.spec.ts` ✅
- Touched-file diagnostics via VS Code `get_errors` ✅
- `apps/kalio-api` full `tsc --noEmit` still fails due pre-existing unrelated `LLMService` API mismatches in `src/modules/llm/llm.controller.ts` and `src/modules/llm/llm.service.spec.ts`.
- Playwright MCP live check against `http://localhost:5188/` ✅
  - UX Designer now used `vfs_write` and `design_preview` in the live session.
  - The current session no longer showed `file_write` in the active chat flow.

## Decisions
- Kept the stop fix in `ChatGateway`, because that is the concrete ownership/dispatch boundary for `chat:stop`.
- Kept seeded prompt preservation as the default behavior; only the legacy rigid UX Designer prompt is auto-upgraded.
- Did not chase the unrelated full-backend typecheck failures in the LLM module.

## Open questions / next steps
- Playwright exposed a separate runtime issue: `design_preview` returned `Preview unavailable. The file is missing or the session expired.` after a confirmed `vfs_write`. That looks like an existing preview/VFS bug outside the prompt fix.
- If child-stop behavior should also be proven end-to-end in the UI, add a Playwright scenario that spawns an orchestrator child loop and clicks the `ConversationManagerPanel` stop control.
