# Kalio Workstation Page UX Redesign Plan

Date: 2026-05-23

## Goal

Keep the current workstation structure:

- left icon rail
- dedicated top-level pages/sections
- central chat and right canvas behavior
- current settings modal direction

The problem is narrower: **Persona and RAApp are dedicated full pages now, but their UI still feels like old modal/sidebar content stretched across the screen**. The redesign should make those pages feel intentional, dense, readable, and page-native.

## Acceptance Criteria

- User can use Persona and RAApp as full pages without feeling like the content is a stretched single list.
- Each page has a clear header, primary action, selected item state, and meaningful empty state.
- Long forms and prompts are constrained to readable widths.
- Desktop layouts use horizontal space with panes, grids, and detail panels.
- Tablet and mobile layouts collapse cleanly without tiny desktop controls.
- Existing left rail, chat page, right canvas, and settings flow remain intact.
- Verified by Playwright screenshots at desktop, tablet, and mobile widths.

## Current Findings

| Area | Problem | Evidence |
|---|---|---|
| Persona page | Single compact list fills a full page with almost no hierarchy. | `apps/kalio-web/src/features/persona/PersonaPanel.tsx` |
| Persona editor | Inline row editing is modal/sidebar density, not full-page editing. | `PersonaForm`, `PersonaRow` in `PersonaPanel.tsx` |
| Persona tools | Tool selection is hidden inside nested accordion-style UI and becomes hard to scan. | `apps/kalio-web/src/features/persona/PersonaToolPicker.tsx` |
| RAApp page | Catalog, Work, and Session are stacked horizontal strips with fixed max heights. | `apps/kalio-web/src/features/raapp/RAAppManager.tsx` |
| RAApp cards | Cards are compact list cards, not page-level catalog/workbench cards. | `RAAppGroupCard.tsx`, `RAAppCoreCard.tsx` |
| Labels | UI still says `RaConsierge`; user-facing naming should become `RAApp`. | `App.tsx`, `LandingPage.tsx`, `PersonaToolPicker.tsx`, `RAAppManager.tsx` |

## Recommended UX Direction

### 1. Persona Page: Master-Detail Workspace

Use a full-page two-pane layout.

| Region | Size | Content |
|---|---:|---|
| Page header | full width | `Personas`, count, short status, primary `New persona` action |
| Left pane | 300-360px | searchable persona list, selected state, compact metadata, empty state |
| Main pane | fluid, constrained inner width | selected persona editor |
| Right utility pane or editor section | 320-420px on wide screens | tool access summary, MCP policy, selected tools |

Editor layout:

- top row: persona name, model, status, save/delete actions
- main prompt editor: readable width, larger textarea, clear dirty state
- permissions panel: searchable grouped tool picker, selected count, policy selector
- preview/test strip: "Start chat with this persona", "Copy system prompt", "Audit tools"

Do not keep editing inside expanded list rows on desktop. That pattern is fine for compact views but weak on full pages.

### 2. RAApp Page: Full Workbench

Use a page-native workbench, not stacked strips.

| Region | Desktop Layout |
|---|---|
| Page header | title `RAApps`, catalog count, work draft count, upload/import CTA, refresh |
| Source rail | `Catalog`, `Drafts`, `Session apps` as vertical segmented navigation |
| Center area | grid/list of selected source items |
| Detail/preview pane | selected app details, renderer preview, actions, version/audit info |

Recommended states:

- Catalog mode: searchable grid of RAApp cards with source badges, version, primary `Run`.
- Drafts mode: work queue with file badges, test/publish actions, last updated, validation status.
- Session mode: generated inline apps with preview-first layout.

The preview/details pane should be the visual anchor. Current `Session` preview appears only after two stacked list regions, which makes the most important artifact feel secondary.

### 3. Responsive Rules

| Width | Persona | RAApp |
|---|---|---|
| >= 1200px | 2-3 pane master-detail | 3-pane workbench |
| 900-1199px | list + editor, tools below editor | source rail + content, preview below or drawer |
| < 768px | single column, list first, editor opens as page section | source tabs, single-column cards, preview as full-width section |

Rules:

- Avoid `input-xs`, `textarea-xs`, and `btn-xs` for primary full-page actions.
- Keep text lines and prompt editors constrained; do not let forms span the whole viewport.
- Right/preview panes collapse before the global left rail changes.
- Preserve keyboard focus order: header actions, source/list, detail editor, utility actions.

## Visual Design Spec

| Element | Direction |
|---|---|
| Page shell | dark workstation UI, same left rail, restrained borders, no decorative blobs |
| Headers | compact but real: title, description/status, primary CTA |
| Cards | 6-8px radius, clear selected state, action row at bottom |
| Density | operational and scannable, closer to IDE/project manager than landing page |
| Color | keep current cyan accent, add neutral surfaces and status badges; avoid one-note blue-only UI |
| Empty states | centered or pane-local with clear next action, not bare text on empty full canvas |
| Naming | replace user-facing `RaConsierge` with `RAApp` |

## Implementation Plan

1. **Layout foundation**
   - Add reusable page primitives if needed: `PageHeader`, `PagePane`, `EmptyState`, `SourceRail`.
   - Keep changes inside frontend feature areas; do not alter shared contracts.

2. **Persona redesign**
   - Split `PersonaPanel.tsx` into `PersonaPanel`, `PersonaList`, `PersonaEditor`, `PersonaPermissionsPanel`.
   - Convert inline expanded editing to selected-detail editing on desktop.
   - Keep mobile fallback as single-column list/detail.
   - Upgrade `PersonaToolPicker` for wide layout: search, grouped sections, selected summary.

3. **RAApp redesign**
   - Split `RAAppManager.tsx` into source rail, catalog grid, work queue, session list, detail preview.
   - Remove stacked `max-h-*` strip layout.
   - Promote `RAAppRenderer` into the detail/preview pane.
   - Rename visible `RaConsierge` text to `RAApp`.

4. **Responsive pass**
   - Test desktop 1440x900 and 1280x720.
   - Test tablet 1024x768.
   - Test mobile 390x844.

5. **Verification**
   - Unit tests for preserved create/edit/delete/run handlers.
   - Playwright screenshots for Persona and RAApp pages.
   - Visual review for empty, loaded, selected, editing, and preview states.

## Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Rebuilding too much behavior while redesigning layout | Higher regression risk | Split layout from behavior; preserve API calls and handlers first |
| Tool picker becomes too large | Can dominate Persona editor | Use grouped panels plus selected summary |
| RAApp workbench becomes too dense | Users may lose current Catalog/Work/Session mental model | Keep those as source modes, just not as stacked strips |
| Mobile regression | Multi-pane desktop UI can break narrow widths | Explicit single-column fallback and Playwright viewport checks |

## Recommended First Slice

Start with **RAApp page redesign**. It has the highest visual payoff because the current page visibly wastes the full canvas and the preview/details concept is already present in `RAAppRenderer`.

Then redesign Persona with the same master-detail pattern, reusing any page primitives created for RAApp.

