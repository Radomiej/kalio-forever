# 2026-05-11 21:30 — image parser + child auto-approve

## What was done

- Added a backend regression in `image-generation.service.spec.ts` proving a 200 HTML body must not surface as a raw JSON parser exception.
- Hardened `ImageGenerationService` JSON parsing for both initial image requests and polling responses so non-JSON success bodies now fail with a clear provider-shape error.
- Added backend regressions for optional child auto-approve in `tool-dispatch.service.spec.ts` and `subagent.tool.spec.ts`.
- Extended backend-only subagent runtime plumbing so `run_subagent` can forward an optional `autoApproveTools` allowlist into child `agentRun` context.
- Restricted optional child auto-approve to isolated subagent runs and to a narrow backend safelist: `image_generate` and `raapp_create`.
- Updated `docs/tool-architecture.md` to reflect the new confirmation policy.

## Files touched

- `apps/kalio-api/src/modules/image/image-generation.service.ts`
- `apps/kalio-api/src/modules/image/image-generation.service.spec.ts`
- `apps/kalio-api/src/modules/chat/tool-dispatch.service.ts`
- `apps/kalio-api/src/modules/chat/__tests__/tool-dispatch.service.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/subagent.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/subagent.tool.spec.ts`
- `apps/kalio-api/src/modules/chat/subagent-runtime.service.ts`
- `apps/kalio-api/src/modules/tool/subagent-runtime.port.ts`
- `docs/tool-architecture.md`

## Validation

- Focused backend tests passed:
  - `apps/kalio-api/src/modules/image/image-generation.service.spec.ts`
  - `apps/kalio-api/src/modules/chat/__tests__/tool-dispatch.service.spec.ts`
  - `apps/kalio-api/src/modules/tool/tools/subagent.tool.spec.ts`
- Backend typecheck passed via `apps/kalio-api/node_modules/.bin/tsc.CMD --noEmit`.
- Touched backend files reported no editor diagnostics.
- Manual browser retest on `http://localhost:5188/`:
  - new Orchestrator chat
  - explicit `run_subagent` request with `personaId=designer`, `vfsMode=isolated`, `autoApproveTools=["image_generate","raapp_create"]`
  - child flow executed without approval prompts
  - observed child tool chain: `image_generate` -> `vfs_write` -> `design_preview`
  - parent VFS received copied outputs:
    - `sub-agents/sub-0597cfa2-9581-441c-ad52-6927e88eecf8/coffee-landing.html`
    - `sub-agents/sub-0597cfa2-9581-441c-ad52-6927e88eecf8/images/coffee-hero.png`
  - no `Expected JSON image response`, no `Image generation failed`, no timeout

## Decisions

- Did not modify shared `@kalio/types` contracts; `autoApproveTools` is backend-internal plumbing only.
- Kept the allowlist narrow and opt-in instead of blanket auto-approving whole subagent sessions.
- Left built-in isolated-child `vfs_write` auto-approve unchanged.

## Open questions / limits

- The live browser verification used the environment's current image config, which resolved to `mock-stock` for the generated image path, so the real remote provider/proxy path was not exercised end-to-end in the browser.
- The provider-shape regression is covered by unit tests, but a live remote-provider retest still requires a configured non-mock image model and working credentials.