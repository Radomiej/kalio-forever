# Desktop UX Polish Design

**Date:** 2026-07-16
**Scope:** Kalio web at 1280x720 and 1440x900. Mobile behavior is explicitly out of scope.

## Outcome

Make the existing dark desktop UI calmer, denser, and easier to scan without changing product behavior, backend contracts, navigation structure, or the visual identity.

## Accepted direction

The live-product audit is the approved design reference. This slice preserves the current dark palette and information architecture while correcting the visible issues found in that audit:

- reduce nested borders and card-within-card framing;
- raise supporting text from 9-10px to a readable 11-12px where space allows;
- tighten oversized empty and launch surfaces;
- make long registries searchable and their state explicit;
- separate provider configuration from runtime configuration in Settings;
- keep desktop settings navigation visible without a second competing scrollbar;
- improve hierarchy on Observability by distinguishing overview, lanes, filters, and timeline;
- keep Architect controls from covering the graph and improve node-label legibility;
- constrain long assistant prose while preserving full-width runtime/architecture evidence.

## Surface decisions

### Home

Application tiles become shorter and less decorative. The large initial is reduced, descriptions become 12px, hover movement is restrained, and the empty HITL inbox loses the redundant outer/inner border pair.

### Talk

The launch form becomes a focused `max-w-4xl` surface with a compact mode switcher, a single prompt surface, and a searchable persona picker. Regular assistant prose is limited to a readable measure, while tool output and architecture timelines remain full width.

### Tools

Add a search field that filters by tool name, description, and MCP server key. Keep groups, show their counts, and display `Confirmation` or `Auto` as text plus icon beside each tool instead of relying on a remote icon-only control.

### Settings

`LLM Settings` owns provider credentials and health. `Runtime Settings` owns the active model and limits. The same runtime form must not appear in both tabs. The desktop sidebar uses compact rows and no independent scrollbar; only the active settings panel scrolls.

### Observability

Overview metrics use a quiet tinted surface, workflow lanes use separators instead of a grid of equal bordered cards, and filter controls use larger labels. Destructive `Clear` remains visually distinct from live/refresh controls.

### Architect

The preset registry remains searchable. Node labels and metadata gain one typography step. Run projection becomes a normal bottom region instead of an absolute overlay on the canvas.

### Mind

Memory scope cards stop repeating the same count twice. The count badge remains the primary count; the footer shows storage size and a concise scope label.

## Accessibility and interaction

- Inputs keep explicit accessible names.
- The persona picker uses combobox/listbox semantics, supports filtering, Escape, Arrow keys, and Enter.
- Icon-only actions retain labels and tooltips.
- Confirmation state uses icon plus text, never color alone.
- Existing focus-visible styles and minimum pointer targets are preserved.

## Non-goals

- No mobile redesign.
- No new design system or dependency.
- No backend/API/contract changes.
- No broad component refactor unrelated to the audited surfaces.
- No Figma or generated visual assets.

## Verification

- Focused Vitest tests for each behavioral or semantic change.
- Frontend typecheck and production build.
- Browser QA at 1440x900 and 1280x720 across Home, Talk, Tools, Mind, Architect, Observability, and Settings.
- Console check for errors/warnings and screenshot comparison against the audit baseline.
