# Orchestrator Designer VFS Flow Verification

## What was done

- Ran a live browser smoke test in Talk with a fresh Orchestrator session.
- Sent a real prompt asking Orchestrator to build a landing page in VFS and show a live preview.
- Inspected live session messages, child-session messages, and runtime code paths for run_subagent, designer, and design_preview.

## Runtime findings

- Orchestrator session startup, chat streaming, and child-session creation worked.
- The live run used `run_subagent` without an explicit `vfsMode`, so backend defaults applied: `isolated` VFS with `copyOutputs: true`.
- The child `designer` session created HTML in its own VFS with `vfs_write`, then called `design_preview` on that HTML successfully.
- The parent session received copied child output metadata and the copied file was readable from the parent VFS.
- Previewing the copied child HTML through the parent `serve-path` route returned HTTP 500 in live verification.

## Persona/prompt findings

- The live persisted `designer` persona is configured correctly for VFS-first work: `vfs_list`, `vfs_write`, `design_preview`, `raapp_create` only for explicit publishing.
- The live persisted `orchestrator` persona is configured to prefer delegation, but in practice it over-plans: it delegated a design brief first, then moved into image generation instead of getting to the main page build quickly.
- The subagent runtime attaches persona system prompt plus a generic focused sub-agent prompt, but does not explicitly tell the child in natural language that isolated outputs will be copied back for the master to inspect.

## Files and surfaces checked

- `apps/kalio-api/src/modules/tool/tools/subagent.tool.ts`
- `apps/kalio-api/src/modules/chat/subagent-runtime.service.ts`
- `apps/kalio-api/src/modules/tool/tools/design-preview.tool.ts`
- `apps/kalio-api/src/assets/personas.json`
- `apps/kalio-web/src/features/raapp/RAAppRenderer.tsx`

## Conclusions

- Designer workflow is VFS-first and working as designed.
- The main runtime weakness observed today is not "designer does not know how"; it is a combination of:
  - Orchestrator spending too much time on briefing/assets before main HTML implementation.
  - A preview-serving defect for copied isolated child HTML in the parent session.

## Next steps

- Tighten Orchestrator prototype-task guidance so first child produces the main HTML entry file before optional asset generation.
- Add a regression around parent preview of copied isolated child HTML (`serve-path` should not 500).