# 2026-05-10 10:12 - SVG diagrams skill and refresh

## What was done

- Reworked the documentation SVGs into a cleaner visual system with title bands, softer backgrounds, rounded cards, shorter labels, and more readable connector labels.
- Refined `docs/kalio_module_architecture.svg`, `docs/kalio_chat_tool_loop.svg`, and `docs/kalio_hitl_gate_flow.svg` based on actual browser render checks instead of markup-only edits.
- Removed fixed `width` attributes from the README SVG embeds so the assets can scale more naturally in Markdown rendering.
- Added a new workspace skill at `.github/skills/svg-diagrams/` for future SVG diagram work.

## Files touched

- `README.md`
- `docs/kalio_module_architecture.svg`
- `docs/kalio_chat_tool_loop.svg`
- `docs/kalio_hitl_gate_flow.svg`
- `.github/skills/svg-diagrams/SKILL.md`
- `.github/skills/svg-diagrams/references/svg-style-guide.md`
- `.github/skills/svg-diagrams/assets/diagram-template.svg`

## Decisions

- Preferred hand-authored SVG over generated output so the diagrams stay stable and readable in docs.
- Kept the diagrams poster-like instead of stuffing implementation paragraphs into cards.
- Added a reusable SVG template and a style guide so future diagram edits use the same visual grammar.

## Validation

- Parsed all final SVG files as XML successfully.
- Opened the refreshed SVGs in the integrated browser and reviewed screenshots after each substantial pass.
- Verified `README.md` has no editor-reported errors after removing fixed image widths.

## Open questions

- None.

## Next steps

- If more docs diagrams are added, use the new `svg-diagrams` skill and split any overloaded diagram before reducing font sizes.