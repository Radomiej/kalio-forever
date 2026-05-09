# 2026-05-02 — Test fixes: Skills/Persona migration

## What was done

Fixed all failing tests triggered by the `skills → allowedTools` / SkillsService migration and related UI changes.

## Backend (kalio-api) — 972/972 tests passing

| File | Fix |
|------|-----|
| `chat.service.spec.ts` | Added `SkillsService` mock provider to all 6 `createTestingModule` blocks |
| `chat.service.event-ordering.spec.ts` | Same: SkillsService mock added |
| `chat-max-iterations.spec.ts` | Same: SkillsService mock added |
| `tool-dispatch.service.spec.ts` | Changed strict `.toHaveBeenCalledWith({...})` to `expect.objectContaining({...})` — `availableTools` and `_emit` fields were added to `ToolCallRequest` |
| `terminal.tools.spec.ts` | Added mandatory `cwd: '/app'` to 3 test cases — `TerminalSpawnTool.execute()` now throws `MISSING_CWD` if `cwd` is absent |

## Frontend (kalio-web) — 262/262 tests passing

| File | Fix |
|------|-----|
| `ChatInput.spec.tsx` | `useSessionStore` mock now returns `sessions: []` — component now reads both `activeSessionId` and `sessions` |
| `ChatInterface.test.tsx` | Added `onReconnect: vi.fn().mockReturnValue(vi.fn())` and `identifySession: vi.fn()` to `eventBus` mock — SDK methods added in commit `06f6557` |
| `SessionPanel.test.tsx` | (1) `useSessionStore` mock wrapped with `Object.assign({ getState: () => mockState })` — component calls `.getState()` outside React; (2) 3 tests updated for always-visible filter chips (removed `getByTitle('Filters')` toggle, use `getAllByText` for ambiguous matches) |
| `LLMPanel.test.tsx` | `mockSetBackendConfig = vi.hoisted(() => vi.fn())` — stable reference prevents `useCallback` from creating a new `load` function every render, which caused infinite `useEffect` re-fires (`Maximum update depth exceeded`) |

## Root causes / lessons

- When a new DI dependency is added to a NestJS service constructor, ALL `createTestingModule` blocks across all test files need the new provider.
- `expect.objectContaining()` should be used when extra fields are added to a DTO used in `.toHaveBeenCalledWith()` assertions.
- Zustand store hooks called outside React (`.getState()`) must be exposed on the mock via `Object.assign`.
- Unstable mock function references (new `vi.fn()` per render) in React hooks that are `useCallback`/`useEffect` dependencies → infinite render loops. Use `vi.hoisted(() => vi.fn())` for stable references.
- UI tests must be updated when component visual structure changes (toggle → always-visible).

## Files touched

- `apps/kalio-api/src/modules/chat/__tests__/chat.service.spec.ts`
- `apps/kalio-api/src/modules/chat/__tests__/chat.service.event-ordering.spec.ts`
- `apps/kalio-api/src/modules/chat/__tests__/chat-max-iterations.spec.ts`
- `apps/kalio-api/src/modules/chat/__tests__/tool-dispatch.service.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/terminal.tools.spec.ts`
- `apps/kalio-web/src/features/chat/ChatInput.spec.tsx`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`
- `apps/kalio-web/src/features/sessions/SessionPanel.test.tsx`
- `apps/kalio-web/src/features/settings/LLMPanel.test.tsx`
