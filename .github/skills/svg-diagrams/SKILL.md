---
name: svg-diagrams
description: "Create or refresh hand-authored SVG diagrams for README and docs. Use when: designing architecture maps, flow diagrams, decision trees, static system diagrams, improving ugly SVGs, converting Mermaid or code structure into polished SVG, or validating that an SVG renders cleanly."
argument-hint: "Optional target: architecture, flow, decision-tree, README, or a file path"
---

# SVG Diagrams

Use this skill when the task is to **create, redesign, or verify a static SVG diagram** that should live in the repository as a durable docs asset.

This workflow is for **hand-authored SVG**, not diagram generators. The goal is a diagram that still looks intentional after it gets embedded in README or docs.

## When to Use

- "Create an SVG diagram for this module"
- "These SVGs are ugly, fix them"
- "Turn this flow into a static diagram"
- "Convert this Mermaid into a polished SVG"
- "Refresh the architecture graphic in docs"
- "Check whether this SVG still matches the runtime"

## Core Rules

1. Ground the diagram in real code, docs, or contracts first. Do not invent boxes just to fill space.
2. Prefer **3-7 main blocks**. If the diagram needs more, split it.
3. Keep text budgets strict. If a card needs a paragraph, the diagram is overloaded.
4. Make the SVG readable at **README scale**. Assume the asset may be seen around 700-900 px wide.
5. Use **hand-authored layout and styles**. Do not leave generator leftovers or hidden junk elements.

## Procedure

### 1. Find the source of truth

- Read the nearby docs, code, or shared types that define the behavior.
- If refreshing an existing asset, read the current SVG first and identify what is wrong:
  - stale semantics
  - too much text
  - weak hierarchy
  - cramped layout
  - unreadable at reduced size

### 2. Reduce the story

Before editing, decide:

- the single diagram type: architecture map, flow, decision tree, timeline, or state view
- the 3-7 key blocks only
- the one sentence the viewer should understand after 3 seconds

If the content still feels crowded, split the diagram instead of shrinking the font.

### 3. Build on the project style

- Start from the template: [diagram-template.svg](./assets/diagram-template.svg)
- Follow the style rules: [svg-style-guide.md](./references/svg-style-guide.md)
- Prefer:
  - a soft background field
  - one title band
  - rounded cards with shadows
  - small category pills
  - short connector labels
  - one consistent palette per diagram

### 4. Keep the copy tight

Use these limits unless there is a strong reason not to:

- title: up to 5 words
- subtitle: up to 20 words
- card title: up to 3 words
- body lines per card: max 2
- characters per body line: target 28-42
- connector label: 1-3 words

If a line breaks because the text is too long, shorten the copy. Do not just widen the canvas forever.

### 5. Validate mechanically

After editing, always parse the SVG as XML:

```powershell
[xml](Get-Content -Raw 'docs/your-diagram.svg') | Out-Null
```

This catches broken tags, invalid nesting, and malformed attributes.

### 6. Validate visually

Open the SVG directly in the integrated browser with a `file:///` URL and inspect the render.

Check for these failures:

- text running outside a card
- labels sitting on top of arrows
- tiny typography after scaling
- too many competing accent colors
- diagrams that feel like notes, not visuals

If the SVG is referenced from README, avoid hard-coded `width` attributes unless there is a specific reason to constrain it.

### 7. Finish cleanly

- Remove junk elements or no-op shapes left from experimentation.
- Keep reusable styles in `<defs>` and `<style>` instead of repeating inline styling everywhere.
- Add a session log in `docs/sessions/` for non-trivial diagram work.

## Quick Checklist

- [ ] Diagram matches current runtime or docs
- [ ] 3-7 main blocks only
- [ ] Background and hierarchy are deliberate
- [ ] No overflowing text
- [ ] XML parse passes
- [ ] Browser preview looks clean
- [ ] README embedding still makes sense

## References

- [svg-style-guide.md](./references/svg-style-guide.md)
- [diagram-template.svg](./assets/diagram-template.svg)