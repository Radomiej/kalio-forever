# 2026-05-02 18:51 — subagent image/VFS hardening

## What was done

- Fixed `image_generate`, `image_view`, and `image_edit` so operational failures throw real errors instead of returning `{ error: ... }` payloads.
- Fixed the same image tools to use `request.vfsSessionId ?? request.sessionId`, so shared-VFS subagents read and write the effective VFS session rather than always their own child session.
- Fixed `image_edit` download URLs to use the live `/api/sessions/:id/vfs/download` route.
- Added focused regression specs for:
  - `image_generate` error propagation and shared VFS writes
  - `image_view` error propagation and shared VFS reads
  - `image_edit` shared VFS reads/writes and thrown write failures
- Tightened `run_subagent` metadata and `SUBAGENT_SYSTEM_PROMPT` so subagents are instructed to:
  - finish with a final textual summary after tool use
  - include exact VFS paths when they create files
  - avoid over-restricting `availableTools`
- Tightened the Orchestrator persona prompt so it:
  - sets `personaId` explicitly for specialist children
  - includes required tools like `vfs_write` / `image_view` when restricting toolsets
  - uses `shared` VFS only when parent-file access is needed
  - prefers `isolated + copyOutputs` for pure file-creation tasks
- Fixed the Orchestrator seeded `allowedTools` so `vfs_write` is visible in `list_tools` and no longer looks absent to the parent agent.
- Restarted the backend in watch mode to reseed personas from `personas.json` and revalidate live behavior.

## Files touched

- `apps/kalio-api/src/modules/tool/tools/image-generate.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/image-view.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/image-edit.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/image-generate.tool.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/image-view.tool.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/image-edit.tool.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/subagent.tool.ts`
- `apps/kalio-api/src/modules/chat/subagent-runtime.service.ts`
- `apps/kalio-api/src/modules/persona/persona.service.spec.ts`
- `apps/kalio-api/src/assets/personas.json`

## Validation

- `pnpm --filter kalio-api test -- src/modules/tool/tools/image-generate.tool.spec.ts src/modules/tool/tools/image-view.tool.spec.ts src/modules/tool/tools/image-edit.tool.spec.ts`
- `pnpm --filter kalio-api test -- src/modules/persona/persona.service.spec.ts`
- Combined focused run:
  - `pnpm --filter kalio-api test -- src/modules/tool/tools/image-generate.tool.spec.ts src/modules/tool/tools/image-view.tool.spec.ts src/modules/tool/tools/image-edit.tool.spec.ts src/modules/persona/persona.service.spec.ts`
- `apps/kalio-api/node_modules/.bin/tsc.CMD --noEmit`
- Manual UI checks in the browser confirmed:
  - `list_tools` now reports `vfs_write` for the Orchestrator persona after backend reseed
  - orchestrator now plans `shared` VFS for cross-child asset access and explicitly includes `vfs_write` when attempting file-producing delegation
  - image tool failures surface as real tool errors instead of fake `success` results
  - child follow-up reuse works in the same child session

## Remaining live limitation

- Shared-VFS `vfs_write` from subagents still enters HITL confirmation and times out if not explicitly approved by the UI. This is now clearly visible as a confirmation/policy constraint rather than a missing tool or fake-success transport bug.
- In live manual runs, some subagents still produce weak or incomplete natural-language summaries even when the underlying tool side effects succeed. The transport and VFS routing are now correct; any further improvement here is primarily prompt/agent-behavior tuning.

## Next steps

- If we want completely unattended parent-file reads plus writes, decide whether to:
  - improve the confirmation UI flow for shared-VFS writes, or
  - formalize a two-step pattern: shared analysis/design child -> isolated writer child with copy-back.