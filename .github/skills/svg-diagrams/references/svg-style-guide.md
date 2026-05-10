# SVG Style Guide

Use this guide for static diagrams that need to look good both as standalone files and inside README/docs pages.

## Layout

- Use `width="100%"` with a `viewBox` on the root SVG.
- Pick one canvas size per diagram family. Good defaults:
  - architecture: `1280 x 780`
  - flow: `1280 x 760`
  - decision tree: `1280 x 760`
- Reserve vertical space for:
  - title band
  - main diagram field
  - optional note band

## Typography

- Title: strong serif or display face for contrast
- Body: clear sans-serif
- Avoid body text below `16px`
- Avoid more than 2 body lines per card
- Prefer shorter nouns over explanatory sentences

## Visual System

- Background: always add a real background rectangle
- Depth: use one soft shadow filter for cards
- Grouping: use pills for sections like `Frontend`, `Backend orchestration`, `Timeout rule`
- Palette: one neutral base plus 2-3 accents max
- Connectors: medium gray, not black

## Copy Rules

- Use product vocabulary that already exists in code/docs
- Prefer `chat:send` over vague phrases like "message event"
- Avoid wrapping code-style names in backticks inside SVG copy unless it materially helps
- If a sentence is too long for a card, split the idea or move detail back into prose docs

## Anti-patterns

- Dense bullet dumps inside a diagram
- Generator leftovers or hidden shapes
- Long paragraphs inside cards
- Tiny captions that only work at full size
- Four different visual styles in one repo
- Lines that cross through card text

## Review Questions

Ask these before finishing:

1. Can someone understand the diagram in 3 seconds?
2. Is every box necessary?
3. Would removing 20% of the words make it better?
4. Does the diagram still work when scaled down?
5. Are the connector labels still readable and well placed?