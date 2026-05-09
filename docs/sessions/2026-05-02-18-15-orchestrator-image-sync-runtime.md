# Orchestrator Image And Sync Runtime Fixes

## What was done

- Reproduced the live orchestrator flow in the browser with real settings: OpenRouter Perplexity for web search and CometAPI for image generation.
- Fixed a frontend regression where completed child-session transcript previews in canvas could go stale or blank after live chunks finished.
- Fixed seeded persona exposure so the `orchestrator` persona can see `image_generate`, `image_edit`, and `image_view`.
- Fixed FLUX routing in `ImageGenerationService` so CometAPI and other OpenAI-compatible `/v1` proxies use the standard image endpoint instead of Replicate-style polling.
- Updated the running `orchestrator` persona over `/api/personas/orchestrator` for immediate live verification without restarting the dev server manually.

## Files touched

- `apps/kalio-web/src/features/chat/CanvasPanel.tsx`
- `apps/kalio-web/src/features/chat/CanvasPanel.test.tsx`
- `apps/kalio-api/src/assets/personas.json`
- `apps/kalio-api/src/modules/persona/persona.service.spec.ts`
- `apps/kalio-api/src/modules/image/image-generation.service.ts`
- `apps/kalio-api/src/modules/image/image-generation.service.spec.ts`

## Key decisions

- Canvas child previews now use per-session state from `sessionStore` as the source of truth; REST transcript fetches are only used to hydrate missing history and are merged into current session state instead of replacing it.
- The `orchestrator` fix was kept minimal: no new persona, just add the existing image tools to the seeded allowed-tool list.
- FLUX routing was aligned with the earlier repository intent: native Replicate keeps async prediction polling, while CometAPI `/v1` uses standard `/images/generations`.

## Validation

- `pnpm --filter kalio-web test -- src/features/chat/CanvasPanel.test.tsx`
- `pnpm --filter kalio-api test -- src/modules/persona/persona.service.spec.ts`
- `pnpm --filter kalio-api test -- src/modules/image/image-generation.service.spec.ts`
- VS Code Problems check on the touched frontend/backend files: no errors
- Manual browser verification at `http://localhost:5188` after live settings + runtime persona update:
  - first orchestrator rerun showed `image_generate` visible and invoked in child runs
  - second orchestrator rerun completed successfully
  - parent summary reported both child session ids and a generated file at `images/cute-sea-otter.png`
  - canvas kept the finished text preview for the research child without needing to open it
  - canvas showed the image child VFS output path in real time after completion

## Findings

- The original image failure was not a missing key: it was the wrong FLUX routing path (`Polling failed: 404`) plus the orchestrator persona not exposing image tools.
- The original canvas preview bug was specific to non-active child sessions whose final reply arrived after the initial REST transcript snapshot.
- The image-generation child itself may finish as a tool-only turn with no final assistant prose. In that case the blank `Agent:` row in the child chat/canvas reflects the underlying child transcript rather than a stale-preview bug.

## Open questions

- The image child UX is still rough when the child finishes with only a tool result. If desired, the next polish step would be to show the generated image or a compact success summary in canvas instead of an empty assistant row.
- The send button overlay issue remains a separate UI flake; keyboard submit was still the reliable path during this verification.