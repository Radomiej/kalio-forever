# Session: Design tools architecture doc

Date: 2026-05-10 10:06
Branch: feature/raapp-v2

## What was done

- Added a new current-state architecture doc for the final design workflow.
- Documented the split between:
  - session-scoped VFS-first prototyping with `design_preview`
  - catalog-backed RA-App release workflows
- Documented the current tool roles for `vfs_*`, `design_preview`, `raapp_create`, `raapp_edit`, `raapp_test`, `raapp_execute_dsl`, `raapp_publish_draft`, `list_raapps`, and `run_raapp`.
- Documented the current frontend/backend ownership chain for preview rendering:
  - `DesignPreviewTool`
  - `VFSService`
  - `SessionVfsController`
  - `ToolCallBubble`
  - `RAAppRenderer`
  - `VfsHtmlRenderer`
  - `HtmlIframeRenderer`
- Added an architecture reading-map link from `application-architecture-current.md`.
- Added a pointer from `raapp-design-current.md` so readers looking for the old RA-App doc can find the new design-flow doc immediately.

## Validation

- Checked markdown files for workspace errors via `get_errors`.
- Validated all new Mermaid diagrams with the Mermaid validator.

## Files touched

- `docs/design-tools-architecture-current.md`
- `docs/application-architecture-current.md`
- `docs/raapp-design-current.md`

## Decisions made

- Chose to add a dedicated design-tools architecture doc instead of overloading `raapp-design-current.md`.
- Kept `raapp-design-current.md` as the deeper runtime/catalog doc and used the new document as the operator-facing workflow doc.
- Kept the doc focused on the current production model: prototype-first in session VFS, publish only on explicit request.

## Open questions

- If the legacy stored-app mutation path in `RAAppService.updateApp()` is removed later, the new doc should be tightened to reflect that the VFS-first draft path is the only edit path.
- If the preview route naming changes again, the doc section about `serve-path` should be updated together with frontend/backend helpers.

## Next steps

1. If needed, add a short link from README or another docs index to the new design-tools architecture doc.
2. If the product language is standardized later, translate the new doc to match the final docs language convention.