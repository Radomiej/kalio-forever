# Session Log: Streaming bug hunt

**Date**: 2026-05-10 23:22  
**Branch**: feature/raapp-v2

## What was done

- Narrowed the slice to streaming logic only.
- Removed the gateway ownership PoCs from the test delta because they were security-scope, not streaming-scope.
- Converted the remaining streaming reproductions into true regression tests that assert the desired behavior and intentionally fail on current code.

## Failing regression tests left in tree

1. **Adapter cancellation regression**
   - File: `apps/kalio-api/src/modules/chat/__tests__/llm-service.adapter.spec.ts`
   - Expected behavior: closing the async iterator should stop upstream work.
   - Current behavior: `LLMServiceAdapter` closes local consumption only; the provider keeps running.

2. **Cross-session UI streaming regression**
   - File: `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`
   - Expected behavior: `tool:result` from a different session must not change active-session streaming state.
   - Current behavior: `ChatInterface` still calls global `setStreaming(true)` on any successful tool result.

## Files touched

- `apps/kalio-api/src/modules/chat/__tests__/chat.gateway.spec.ts`
- `apps/kalio-api/src/modules/chat/__tests__/llm-service.adapter.spec.ts`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`

## Validation status

- Backend command:
   - `Push-Location apps/kalio-api; node_modules\.bin\vitest.cmd run src/modules/chat/__tests__/llm-service.adapter.spec.ts; Pop-Location`
   - Result: 1 failing test, expected reason confirmed
   - Failure: adapter still allows upstream work after iterator close
- Frontend command:
   - `Push-Location apps/kalio-web; node_modules\.bin\vitest.cmd run src/features/chat/ChatInterface.test.tsx; Pop-Location`
   - Result: 1 failing test, expected reason confirmed
   - Failure: background session `tool:result` still calls global `setStreaming(true)`

## Decisions made

- Left the tests failing on purpose so the behavior can be re-run locally before any fix.
- Kept the assertions at the behavior boundary rather than asserting current buggy internals.

## Follow-up outcome

- Confirmed the original disabled-input Playwright failure was not a pure `ChatInput` bug. The first screenshot showed the red stop button and ongoing `Thinking`, which meant the UI was still globally streaming.
- Added a frontend regression in `apps/kalio-web/src/features/chat/ChatInterface.test.tsx` and hardened `ChatInterface.tsx` so `agent:done` now clears streaming for the active session even when `chat:complete` never arrives.
- Reworked the flaky Playwright scenario in `apps/e2e/tests/ac-raapp-ecs-live.spec.ts` so it no longer depends on the broken `visual-calculator` runtime launch path. The test now uses the deterministic `qa-interactive` seeded app, the `ra-apps` persona, complete required inputs, and asserts GUI render plus chat-input re-enable.
- Added a defensive backend regression in `apps/kalio-api/src/modules/tool/tools/raapp.tools.spec.ts` and `raapp.tools.ts`: `run_raapp` now reloads the RA-App catalog once before returning the hard "no renderable content" error.

## Additional files touched

- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`
- `apps/e2e/tests/ac-raapp-ecs-live.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp.tools.spec.ts`

## Final validation

- `apps/kalio-web`: `vitest run src/features/chat/ChatInterface.test.tsx` ✅
- `apps/kalio-api`: `vitest run src/modules/tool/tools/raapp.tools.spec.ts` ✅
- `apps/e2e`: `playwright test tests/ac-raapp-ecs-live.spec.ts --retries=0` ✅ (`4 passed`)

## Open question

- `visual-calculator` is still listed in the live catalog but `run_raapp` returns the "missing renderable content" error in the current dev runtime. That looks like a separate backend/runtime asset issue worth a dedicated follow-up, but it is no longer blocking the Playwright slice that was failing here.

## 2026-05-10 23:40 streaming fixes applied

### What was done

- Fixed backend stream cancellation at the actual contract boundary instead of only stopping local consumption.
- Fixed frontend `tool:result` handling so background-session tool completions no longer re-enable streaming for the active session.

### Files touched

- `apps/kalio-api/src/modules/chat/interfaces/llm-source.interface.ts`
- `apps/kalio-api/src/modules/chat/chat.service.ts`
- `apps/kalio-api/src/modules/chat/subagent-runtime.service.ts`
- `apps/kalio-api/src/modules/chat/llm-service.adapter.ts`
- `apps/kalio-api/src/modules/llm/llm.types.ts`
- `apps/kalio-api/src/modules/llm/llm.service.ts`
- `apps/kalio-api/src/modules/llm/providers/base-openai-compatible.provider.ts`
- `apps/kalio-api/src/modules/llm/providers/openai-compatible.provider.ts`
- `apps/kalio-api/src/modules/llm/providers/mock.provider.ts`
- `apps/kalio-api/src/modules/chat/__tests__/llm-service.adapter.spec.ts`
- `apps/kalio-web/src/features/chat/ChatInterface.tsx`

### Decisions made

- Extended the internal/backend streaming contract with an optional `AbortSignal` and propagated it from `ChatService` and `SubagentRuntime` into `LLMServiceAdapter` and provider fetch/read loops.
- Kept `AbortSignal` optional on the provider contract to avoid unnecessary churn in unrelated call sites and tests.
- Tightened the backend regression so it verifies the actionable cancellation channel (`AbortSignal`) instead of relying on a mock provider that had no way to observe iterator closure.

### Validation

- `Push-Location apps/kalio-api; node_modules\.bin\vitest.cmd run src/modules/chat/__tests__/llm-service.adapter.spec.ts; Pop-Location` ✅
- `Push-Location apps/kalio-web; node_modules\.bin\vitest.cmd run src/features/chat/ChatInterface.test.tsx; Pop-Location` ✅
- VS Code diagnostics on all touched backend/frontend files: no errors

## 2026-05-11 00:02 additional streaming regressions

### What was done

- Added two more backend streaming regressions around `AbortSignal` behavior in `LLMServiceAdapter`.
- Added one more frontend regression proving `chat:complete` from a background session does not mutate active-session streaming state.
- Ran app-level TypeScript checks for both `apps/kalio-api` and `apps/kalio-web` after the earlier streaming contract change.

### Files touched

- `apps/kalio-api/src/modules/chat/__tests__/llm-service.adapter.spec.ts`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`

### New regressions added

- Adapter does not call upstream `streamChat()` when the parent abort signal is already aborted.
- Adapter ends cleanly on mid-stream parent abort without surfacing trailing tool calls or a spurious `done` emission.
- `ChatInterface` ignores `chat:complete` streaming state changes from a different session.

### Validation

- `Push-Location apps/kalio-api; node_modules\.bin\vitest.cmd run src/modules/chat/__tests__/llm-service.adapter.spec.ts; Pop-Location` ✅ (`8 passed`)
- `Push-Location apps/kalio-web; node_modules\.bin\vitest.cmd run src/features/chat/ChatInterface.test.tsx; Pop-Location` ✅ (`39 passed`)
- `Push-Location apps/kalio-api; node_modules\.bin\tsc.cmd --noEmit; Pop-Location` ✅
- `Push-Location apps/kalio-web; node_modules\.bin\tsc.cmd --noEmit; Pop-Location` ✅
- VS Code diagnostics on the touched test files: no errors

## 2026-05-10 23:46 live RA-App runtime follow-up

### What was done

- Verified earlier live `start-dev.ps1` output was a real product issue, not just a flaky Playwright path: runtime core loaded duplicate `visual-calculator` entries and the later duplicate could overwrite the renderable one.
- Added a backend regression to `RAAppService` and changed catalog loading so duplicate IDs keep the more renderable app instead of blindly overwriting by load order.
- Added a frontend VFS preview fallback so missing/expired session files now show a friendly unavailable state instead of a dead iframe.
- Extracted the RA-App resize bridge into a single shared helper used by both frontend iframe rendering and backend VFS HTML serving.
- Removed the dead `RAAppService.executeSystems()` path and its tests after confirming there were no runtime call sites.

### Files touched

- `apps/kalio-api/src/modules/raapp/raapp.service.ts`
- `apps/kalio-api/src/modules/raapp/raapp.service.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp.tools.spec.ts`
- `apps/kalio-api/src/modules/vfs/vfs.service.ts`
- `apps/kalio-web/src/features/raapp/VfsHtmlRenderer.tsx`
- `apps/kalio-web/src/features/raapp/VfsHtmlRenderer.test.tsx`
- `apps/kalio-web/src/features/raapp/HtmlIframeRenderer.tsx`
- `apps/shared/raapp-preview-bridge.ts`

### Decisions made

- Duplicate runtime RA-Apps are resolved by content quality first: keep the app with renderable HTML/GUI content, and on equal renderability prefer the unpacked directory over the archive.
- The VFS preview fallback stays in `VfsHtmlRenderer`, not `HtmlIframeRenderer`, because only the VFS-backed path needs the missing-file/session-expired preflight.
- The resize bridge helper is shared from `apps/shared/` to avoid backend/frontend drift without widening the contract surface in `@kalio/types`.

### Validation

- `Push-Location apps/kalio-api; node_modules\.bin\vitest.cmd run src/modules/raapp/raapp.service.spec.ts; Pop-Location` ✅
- `Push-Location apps/kalio-api; node_modules\.bin\vitest.cmd run src/modules/tool/tools/raapp.tools.spec.ts; Pop-Location` ✅
- `Push-Location apps/kalio-api; node_modules\.bin\vitest.cmd run src/modules/vfs/vfs.service.spec.ts; Pop-Location` ✅
- `Push-Location apps/kalio-web; node_modules\.bin\vitest.cmd run src/features/raapp/VfsHtmlRenderer.test.tsx src/features/raapp/HtmlIframeRenderer.test.tsx; Pop-Location` ✅
- `Push-Location apps/kalio-api; node_modules\.bin\tsc.cmd --noEmit; Pop-Location` ✅
- `Push-Location apps/kalio-web; node_modules\.bin\tsc.cmd --noEmit; Pop-Location` ✅

### Remaining note

- I did not rerun the full live browser launch path after the code change; the post-fix verification here is regression-test plus typecheck coverage around the exact loader/preview slices that were changed.

## 2026-05-11 00:12 visual-calculator live browser verification

### What was done

- Re-ran `start-dev.ps1` using the stable detached-PowerShell pattern because captured terminal output still triggers the known Windows Vite/Tailwind crash.
- Verified the original `visual-calculator` launch bug was fixed at the catalog-loader level: live runtime now keeps the renderable duplicate and exposes the app consistently.
- Found and fixed two follow-on `visual-calculator` asset issues revealed only by the real browser flow:
   - `meta.yml` used legacy `inputs`/`outputs` fields instead of `input_schema`, so the agent had no contract for required values.
   - `ui.gui` used bare `[a]` / `[result]` bindings while `run_raapp` supplies GUI data under `output.*`.
- Updated both the source asset and the live runtime extracted copy so the browser launch now resolves to a rendered calculator result.

### Files touched

- `apps/kalio-api/src/modules/raapp/raapp.service.spec.ts`
- `apps/kalio-api/src/assets/ra-apps/core/visual-calculator/meta.yml`
- `apps/kalio-api/src/assets/ra-apps/core/visual-calculator/ui.gui`
- `apps/kalio-api/data/ra-apps/core/visual-calculator-extracted/meta.yml`
- `apps/kalio-api/data/ra-apps/core/visual-calculator-extracted/ui.gui`

### Validation

- `Push-Location apps/kalio-api; node_modules\.bin\vitest.cmd run src/modules/raapp/raapp.service.spec.ts; Pop-Location` ✅
- Live API checks after detached restart:
   - `GET /api/health` ✅
   - `GET /` on `http://localhost:5188` ✅
- Live Playwright browser flow ✅
   - Opened `Home` → `Open Visual Calculator`
   - Confirmed agent saw `input_schema` for `a`, `b`, `operation`
   - Confirmed `run_raapp` executed with sample inputs `{ a: 15, b: 7, operation: 'add' }`
   - Confirmed rendered GUI showed `15 + 7 = 22`

## 2026-05-11 00:57 review follow-up regressions fixed

### What was done

- Added failing regression coverage for two missed frontend session-scope leaks in `ChatInterface`:
  - `chat:error` from a background session no longer clears active-session streaming state.
  - socket reconnect now clears tool activity only for the active session instead of wiping all sessions.
- Added a failing regression for overlapping `ChatService.handleTurn()` calls sharing one `sessionId`; fixed the abort-controller cleanup so an older turn cannot delete the newer controller.
- Added a failing regression for unpacked user RA-Apps stored as directories; `RAAppService.delete()` now removes both `.zip` uploads and directory-backed apps via `fs.rm(..., { recursive: true, force: true })`.
- Added failing regressions for both OpenAI-compatible providers so mid-stream abort always releases `response.body.getReader()` via `finally`.

### Files touched

- `apps/kalio-web/src/features/chat/ChatInterface.tsx`
- `apps/kalio-web/src/features/chat/ChatInterface.test.tsx`
- `apps/kalio-api/src/modules/chat/chat.service.ts`
- `apps/kalio-api/src/modules/chat/__tests__/chat.service.spec.ts`
- `apps/kalio-api/src/modules/raapp/raapp.service.ts`
- `apps/kalio-api/src/modules/raapp/raapp.service.spec.ts`
- `apps/kalio-api/src/modules/llm/providers/openai-compatible.provider.ts`
- `apps/kalio-api/src/modules/llm/providers/openai-compatible.provider.spec.ts`
- `apps/kalio-api/src/modules/llm/providers/base-openai-compatible.provider.ts`
- `apps/kalio-api/src/modules/llm/providers/base-openai-compatible.provider.spec.ts`

### Duplicate assessment

- Verified that `apps/kalio-api/src/modules/vfs/raapp-preview-bridge.ts` and `apps/kalio-web/src/features/raapp/raapp-preview-bridge.ts` are still byte-identical.
- Did not deduplicate them in this change: the earlier shared-path extraction already failed in live Nest/Vite runtime, so removing that duplication safely requires a real shared package extraction, not another ad-hoc cross-app import.

### Validation

- `Push-Location apps/kalio-web; node_modules\.bin\vitest.cmd run src/features/chat/ChatInterface.test.tsx; Pop-Location` ✅
- `Push-Location apps/kalio-api; node_modules\.bin\vitest.cmd run src/modules/chat/__tests__/chat.service.spec.ts; Pop-Location` ✅
- `Push-Location apps/kalio-api; node_modules\.bin\vitest.cmd run src/modules/raapp/raapp.service.spec.ts src/modules/llm/providers/openai-compatible.provider.spec.ts src/modules/llm/providers/base-openai-compatible.provider.spec.ts; Pop-Location` ✅
- VS Code diagnostics on all touched files ✅

## 2026-05-11 10:06 remaining review follow-up applied

### What was done

- Added a regression for `run_raapp` when catalog reload fails after a stale non-renderable app lookup, then changed the tool to keep the existing no-renderable-content error instead of throwing the raw `raapp.init()` failure.
- Added a regression for VFS preview preflight auth and changed `VfsHtmlRenderer` to call `fetch(src, { signal, credentials: 'include' })`.
- Added a regression for duplicate loader observability and changed `RAAppService.storeLoadedApp()` to log when an equal-score duplicate replaces an existing app.

### Files touched

- `apps/kalio-api/src/modules/tool/tools/raapp.tools.ts`
- `apps/kalio-api/src/modules/tool/tools/raapp.tools.spec.ts`
- `apps/kalio-api/src/modules/raapp/raapp.service.ts`
- `apps/kalio-api/src/modules/raapp/raapp.service.spec.ts`
- `apps/kalio-web/src/features/raapp/VfsHtmlRenderer.tsx`
- `apps/kalio-web/src/features/raapp/VfsHtmlRenderer.test.tsx`

### Validation

- `Push-Location apps/kalio-api; node_modules\.bin\vitest.cmd run src/modules/tool/tools/raapp.tools.spec.ts src/modules/raapp/raapp.service.spec.ts; Pop-Location` ✅
- `Push-Location apps/kalio-web; node_modules\.bin\vitest.cmd run src/features/raapp/VfsHtmlRenderer.test.tsx; Pop-Location` ✅
- VS Code diagnostics on touched files ✅

### Remaining note

- The duplicated RA-App preview bridge helper still exists on purpose in backend and frontend local `src` trees. I did not deduplicate it here because the previous shared-path extraction already broke live runtime resolution; that needs a real shared package or a parity check, not another direct cross-app import.