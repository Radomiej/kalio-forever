# Session: RA-App capability matrix

**Date**: 2026-05-11 01:00

## What was done

- Audited the current RA-App, design-preview, VFS preview, draft/publish, GUI DSL, and HITL flows to answer what users can actually do today in conversation.
- Compared runtime behavior against persona prompts and architecture docs to separate supported workflows from aspirational or partial ones.
- Verified the exposed UI surfaces with Playwright against the local app:
  - Home shows stored RA-App tiles.
  - Tools exposes the RA-App tool chain (`raapp_create`, `run_raapp`, `raapp_get`, `raapp_edit`, `raapp_create_draft`, `raapp_execute_dsl`, `raapp_publish_draft`, `raapp_test`).
  - Mind -> Files exposes session-scoped VFS work areas.

## Key findings

- **Prototype websites are strong today** when kept VFS-first: `vfs_write` + `design_preview` supports multi-file HTML/CSS/JS/assets through the path-based `serve-path` runtime.
- **Stored HTML RA-Apps are still limited**: `run_raapp` loads only `main.html` / `index.html` and renders via inline HTML, so packaged sibling assets from the RA-App ZIP are not served at runtime.
- **GUI DSL apps are real and usable today** for input -> output widgets and ECS-style logic apps.
- **Approval exists today**, but it is driven by `call_native` pending approvals, not by the `meta.execution.requires_user_approval` flag.
- **`expose_as_tool` is metadata, not real tool registration**. RA-Apps remain launched through `run_raapp`; they do not appear as standalone tool names in the registry.
- **`components.yml` is not wired into runtime execution**. It is readable/editable, and `EntityStore` has `initGlobals()`, but current execution paths do not call it.
- **`ui_yml` looks partial/misleading**: the draft execution path reads `ui.yml` and passes its raw contents straight to HTML execution; there is no current YAML-to-HTML compilation step in the runtime.
- **Two persistence lanes still exist**:
  - `raapp_create` saves standalone flat ZIPs.
  - draft-first publish uses grouped versioned releases via `RAAppVersioningService`.

## Decision-quality summary

This is already a strong solution for:

- VFS-first website prototyping
- GUI DSL widgets with deterministic input/output
- draft/test/publish lifecycle for logic-heavy RA-Apps
- approval-gated native side effects inside RA-App execution

This is not yet a complete solution for:

- unified "app as first-class tool" registration
- published multi-file HTML apps with bundled runtime assets
- first-class shared component definitions through `components.yml`
- a clean, trustworthy `ui_yml` authoring/runtime story

## Files read / checked

- `apps/kalio-api/src/modules/tool/tools/design-preview.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-crud.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-draft.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp-test.tools.ts`
- `apps/kalio-api/src/modules/raapp/raapp.service.ts`
- `apps/kalio-api/src/modules/raapp/effects-processor.service.ts`
- `apps/kalio-api/src/modules/raapp/raapp-hitl.service.ts`
- `apps/kalio-api/src/modules/vfs/vfs.service.ts`
- `apps/kalio-api/src/modules/vfs/session-vfs.controller.ts`
- `apps/kalio-web/src/features/raapp/RAAppRenderer.tsx`
- `apps/kalio-web/src/features/raapp/VfsHtmlRenderer.tsx`
- `apps/kalio-web/src/features/raapp/GuiDslRenderer.tsx`
- `apps/kalio-api/src/assets/personas.json`
- `docs/design-tools-architecture-current.md`
- `docs/raapp-design-current.md`
- `docs/raapp-v2-architecture-current.md`

## Open gaps / next steps

1. Decide whether published multi-file HTML apps are a product requirement. If yes, stored RA-App runtime needs asset serving, not just inline HTML loading.
2. Decide whether RA-Apps should become real registry tools. If yes, `expose_as_tool` needs dispatch/registry integration instead of catalog-only metadata.
3. Either wire `components.yml` and `ui_yml` into runtime properly or stop presenting them as supported authoring surfaces.
4. Consider unifying `raapp_create` into the same grouped versioned publish lane as draft-first releases.