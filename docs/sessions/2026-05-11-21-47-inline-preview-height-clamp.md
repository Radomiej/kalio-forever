# 2026-05-11 21:47 — inline preview height clamp

## What was done

- Reproduced the design preview height runaway on a live `design_preview` result using `custom-image-check.html` and a custom VFS image asset.
- Confirmed the problem was not an active resize-feedback loop: the iframe height stayed stable but absurdly large because the preview bubble was very narrow and `HtmlIframeRenderer` accepted the full reported content height.
- Added a frontend regression in `HtmlIframeRenderer.test.tsx` for absurdly tall `raapp_resize` events.
- Added a hard inline height clamp in `HtmlIframeRenderer.tsx` while leaving fullscreen behavior unchanged.

## Files touched

- `apps/kalio-web/src/features/raapp/HtmlIframeRenderer.tsx`
- `apps/kalio-web/src/features/raapp/HtmlIframeRenderer.test.tsx`

## Reproduction notes

- Live preview URL: `http://localhost:3016/api/sessions/hD_L8dbviDjd9RyE6BSlA/vfs/serve-path/custom-image-check.html`
- Before fix:
  - inline iframe width was ~29.6 px in the narrow chat bubble
  - inline iframe height was ~13845 px
  - frame metrics reported `innerHeight ~= scrollHeight`, showing the renderer was simply trusting a huge content height in a squeezed layout
- After fix:
  - inline iframe height clamps to `1200px`
  - same preview still renders and fullscreen remains available for the full page

## Validation

- `apps/kalio-web/src/features/raapp/HtmlIframeRenderer.test.tsx` — PASS
- `apps/kalio-web/node_modules/.bin/tsc.cmd --noEmit` — PASS
- editor diagnostics on touched files — none
- live browser retest on the same `custom-image-check.html` preview:
  - before: `13845px`
  - after reload with fix: `1200px`

## Decisions

- Kept the fix local to inline iframe rendering.
- Did not change fullscreen height behavior.
- Did not chase the narrow-column layout in the same change; the immediate bug was uncontrolled inline height expansion.