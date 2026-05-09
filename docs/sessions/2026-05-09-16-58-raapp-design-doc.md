# Session: RAApp Design Documentation

**Date**: 2026-05-09 16:58

## What Was Done

Reviewed the current RAApp implementation and added a Markdown document that explains:

- how `raapp_create` and `run_raapp` currently work,
- the difference between `html` and `gui` RAApps,
- how pages and component-like structures are added today,
- where RAApps are stored on disk,
- whether RAApps are visible in VFS,
- what "load from filesystem" means in the current implementation.

## Files Touched

- `docs/raapp-design-current.md`
- `docs/sessions/2026-05-09-16-58-raapp-design-doc.md`

## Key Findings

- RAApps are stored in the RA-App catalog under `RA_APPS_PATH` rather than session VFS.
- `html` RAApps are effectively single-document apps: the loader reads only `main.html` or `index.html` and renders via iframe `srcDoc`.
- `gui` RAApps are effectively single-file DSL apps: the loader reads `ui.gui`, compiles it to `{ nodes, data }`, and renders through `GuiDslRenderer`.
- Additional ZIP files are not exposed as runtime assets, so multi-page HTML must be implemented inside one HTML document.
- GUI has limited component-like composition through `template`, `types`, `using`, `block`, and `blockoverride`, but it is not a full component/runtime system.
- The RAApp catalog UI currently has no VFS integration; `onOpenVFS` is intentionally unused.

## Decisions Made

- Documented the current behavior as-is instead of proposing a new architecture.
- Called out the practical boundary that `html` is the right choice for real multi-view UX, while `gui` is better for small declarative widgets.
- Documented filesystem loading strictly at the catalog/package level to avoid implying runtime file access that does not exist.

## Next Steps

- If needed, add a follow-up doc with a recommended authoring workflow for building RAApps from repo sources and packaging them into ZIPs.
- If VFS-backed editing of stored RAApps is desired, that needs a separate implementation; it is not present today.