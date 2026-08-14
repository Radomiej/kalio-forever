# Desktop UX Polish Implementation Plan

> Execute inline in this task. Preserve unrelated dirty worktree changes and do not commit unless requested.

**Goal:** Resolve the desktop visual and interaction findings from the live UX audit without changing backend behavior or mobile layouts.

**Architecture:** Keep the existing feature-oriented React structure. Add one co-located persona combobox component, extend existing focused feature components, and make presentation-only changes in oversized pages. Shared API and runtime contracts remain untouched.

**Tech stack:** React 19, TypeScript 5.8 strict, Tailwind CSS 4, daisyUI 5, Vitest, Testing Library, Playwright/in-app browser.

---

## Task 1: Home density and border cleanup

**Files:**
- Modify: `apps/kalio-web/src/features/landing/LandingPage.tsx`
- Modify: `apps/kalio-web/src/features/landing/AppTile.tsx`
- Modify: `apps/kalio-web/src/features/landing/HomeHitlInbox.tsx`
- Test: `apps/kalio-web/src/features/landing/AppTile.test.tsx`
- Test: `apps/kalio-web/src/features/landing/LandingPage.test.tsx`

1. Add failing assertions for a compact tile surface, readable description text, and an unframed empty HITL state.
2. Run the two focused test files and confirm the new assertions fail.
3. Replace square/tall tile sizing with a compact desktop minimum height, soften the decorative initial and hover transform, and raise description typography.
4. Remove the redundant empty-inbox frame while retaining bordered approval cards.
5. Re-run the focused tests.

## Task 2: Talk launch hierarchy and readable prose

**Files:**
- Create: `apps/kalio-web/src/features/chat/launch/PersonaCombobox.tsx`
- Create: `apps/kalio-web/src/features/chat/launch/PersonaCombobox.test.tsx`
- Modify: `apps/kalio-web/src/features/chat/launch/NewChatScreen.tsx`
- Modify: `apps/kalio-web/src/features/chat/ChatInterface.Parts.test.tsx`
- Modify: `apps/kalio-web/src/features/chat/MessageBubble.tsx`
- Modify: `apps/kalio-web/src/features/chat/AgentTurnBubble.tsx`
- Modify: `apps/kalio-web/src/features/chat/MessageBubble.test.tsx`
- Modify: `apps/kalio-web/src/features/chat/AgentTurnBubble.test.tsx`

1. Write failing combobox tests for filtering, selection, Escape, Arrow navigation, and Enter.
2. Update the existing launch-screen tests to interact with the combobox rather than a native select; confirm failure.
3. Implement the co-located accessible combobox without adding a dependency.
4. Tighten the launch surface to `max-w-4xl`, make the mode switcher content-width, reduce decorative whitespace, and keep one clear prompt boundary.
5. Add failing tests that regular assistant prose has a readable max measure while the outer runtime lane remains full width.
6. Add the prose wrapper in regular message output only; leave tool/runtime evidence full width.
7. Run the focused Talk tests.

## Task 3: Tool registry scanning

**Files:**
- Modify: `apps/kalio-web/src/features/tools/ToolPanel.tsx`
- Modify: `apps/kalio-web/src/features/tools/ToolPanel.test.tsx`

1. Add failing tests for search filtering and visible confirmation-state text.
2. Run the focused test and confirm failure.
3. Add a sticky search/header area, group counts, and filtering by name, description, and server key.
4. Place icon-plus-text confirmation state next to each tool and retain optimistic persistence/revert behavior.
5. Re-run the focused test.

## Task 4: Settings information architecture and scroll ownership

**Files:**
- Modify: `apps/kalio-web/src/features/settings/LLMPanel.tsx`
- Modify: `apps/kalio-web/src/features/settings/LLMPanel.RuntimeSettings.tsx`
- Modify: `apps/kalio-web/src/features/settings/LLMPanel.test.tsx`
- Modify: `apps/kalio-web/src/features/settings/SettingsModal.tsx`
- Modify: `apps/kalio-web/src/features/settings/SettingsModal.test.tsx`

1. Add failing tests that full LLM settings do not render the runtime form and that desktop navigation does not own a vertical scrollbar.
2. Run both focused settings tests and confirm failure.
3. Render runtime controls only in runtime mode and update the full-mode description.
4. Remove the redundant outer runtime card border and make the desktop sidebar compact with panel-only scrolling.
5. Re-run the focused settings tests.

## Task 5: Observability hierarchy

**Files:**
- Modify: `apps/kalio-web/src/features/observability/TruthBoard.tsx`
- Modify: `apps/kalio-web/src/features/observability/ObservabilityPage.tsx`
- Modify: `apps/kalio-web/src/features/observability/TruthBoard.test.tsx`
- Modify: `apps/kalio-web/src/features/observability/ObservabilityPage.test.tsx`

1. Add failing visual-contract assertions for quiet overview surfaces, border-light lanes, and readable filter labels.
2. Run the focused tests and confirm failure.
3. Restyle overview cards, turn lane cards into a divided strip, raise tiny labels, and group destructive/refresh/live controls by meaning.
4. Re-run the focused tests.

## Task 6: Architect overlay and typography

**Files:**
- Modify: `apps/kalio-web/src/features/architect/ArchitectPage.tsx`
- Modify: `apps/kalio-web/src/features/architect/ArchitectGraphNodeCard.tsx`
- Modify: `apps/kalio-web/src/features/architect/ArchitectPage.test.tsx`
- Modify: `apps/kalio-web/src/features/architect/ArchitectGraphNodeCard.test.tsx`

1. Add failing assertions that projection is a non-overlay region and node labels use readable text sizing.
2. Run the focused tests and confirm failure.
3. Make the canvas/projection container a vertical flex layout with projection as a shrinkable bottom region.
4. Raise node title, role, slot, and badge typography by one step without changing graph geometry or hitboxes.
5. Re-run the focused tests.

## Task 7: Mind card repetition

**Files:**
- Modify: `apps/kalio-web/src/features/memory/MemoryPage.tsx`
- Modify: `apps/kalio-web/src/features/memory/MemoryPage.test.tsx`

1. Add a failing assertion that a scope card exposes the count once.
2. Run the focused test and confirm failure.
3. Keep the badge count and replace the repeated footer count with a concise scope label plus storage size.
4. Re-run the focused test.

## Task 8: Full verification and desktop browser QA

1. Run all touched frontend test files with system Node.
2. Run `pnpm --filter kalio-web run typecheck`.
3. Run `pnpm --filter kalio-web run build`.
4. Reload `http://127.0.0.1:5188/` and inspect Home, Talk, Tools, Mind, Architect, Observability, and Settings at 1440x900.
5. Repeat overflow and settings checks at 1280x720.
6. Check browser console for warnings/errors and capture after screenshots.
7. Review `git diff --check`, the focused diff, and the worktree status to ensure unrelated user changes remain untouched.
