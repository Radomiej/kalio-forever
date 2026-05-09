# 2026-05-02 19:10 — orchestrator cats prototype retest

## What was done

- Re-reviewed the latest image/VFS/subagent changes against the live app behavior.
- Cleaned one minor style defect left by the previous patch (`image-edit.tool.ts` indentation only).
- Added a regression to keep the seeded `orchestrator` prompt aligned with the manual acceptance scenario:
  - respect explicit user tool allowlists
  - prefer generated image `download_url` values
  - use distinct filenames for image variants
- Tightened `apps/kalio-api/src/assets/personas.json` accordingly and updated the live `orchestrator` persona through the API so the running backend used the new prompt immediately.
- Added a runtime regression showing that isolated child outputs were copied back without surfacing ready-to-use parent download URLs in `run_subagent` results.
- Fixed `SubagentRuntimeService` to append parent-session VFS download URLs for copied artifacts into the returned `result` text.
- Tightened the subagent system prompt so child agents are explicitly told to include exact download URLs in their final answer when tools return them.

## Files touched

- `apps/kalio-api/src/assets/personas.json`
- `apps/kalio-api/src/modules/persona/persona.service.spec.ts`
- `apps/kalio-api/src/modules/chat/subagent-runtime.service.ts`
- `apps/kalio-api/src/modules/chat/__tests__/subagent-runtime.service.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/image-edit.tool.ts`

## Validation

- `pnpm --filter kalio-api test -- src/modules/persona/persona.service.spec.ts`
- `pnpm --filter kalio-api test -- src/modules/chat/__tests__/subagent-runtime.service.spec.ts`
- `apps/kalio-api/node_modules/.bin/tsc.CMD --noEmit`
- Focused `image-edit.tool.spec.ts` rerun after the style cleanup

## Manual constrained reruns

Scenario target:

- Orchestrator chat should use only `web_search`, `image_generate`, `raapp_create` plus delegation tools.
- It should create a cat landing-page prototype with two custom generated cat images, prove same-child follow-up, and finish cleanly.

### Run 1 (before new prompt/runtime fixes)

- Failed acceptance.
- Parent violated the requested functional-tool constraint by calling `persona_list` and `vfs_list`.
- Same-child image follow-up did not yield a second image in a usable way.
- Parent fell back to extra web image URL discovery and a builder child eventually rendered an RAApp, but it used public Unsplash/Pexels image URLs rather than the generated custom images.
- The parent master turn ended with `MAX_ITERATIONS_REACHED` instead of a clean final answer.

### Run 2 (after orchestrator prompt fix)

- Improved tool discipline: the visible parent tool list no longer showed `persona_list` / `vfs_list` drift in the monitored part of the run.
- Remaining problem: the parent still could not reliably consume image-child outputs as embed-ready local URLs, so the flow still drifted and did not reach a clean acceptance state.

### Run 3 (after runtime copied-output URL fix)

- Tool discipline held: the visible parent tool flow used only `run_subagent`, with child tool usage restricted to `web_search` and `image_generate` in the observed state.
- The parent master session did **not** violate the original allowlist with `persona_list` or `vfs_list` in the observed run.
- The run still failed acceptance because the image child `sub-1dec5a69-c9e3-45e7-b89f-c337ac373a6e` timed out after `60000ms` before the flow could reach the builder stage.
- Result: no clean end-to-end completion for the strict “two custom generated cat images + RAApp only” scenario yet.

## Key findings

- The orchestrator prompt needed explicit policy to respect user-specified functional-tool limits; otherwise it opportunistically reached for helper tools.
- Returning only copied file paths from `run_subagent` was not enough for downstream orchestration. The parent needed embed-ready parent URLs for isolated child artifacts.
- After those two fixes, the dominant remaining live blocker is subagent timeout on image-generation runs, not tool visibility or fake-success transport.

## Remaining open issue

- The strict cats prototype scenario is still not fully green end-to-end because an image-generation child can time out at the default `60000ms` before the master reaches the builder child.
- The next likely fix is timeout policy, not more VFS/result plumbing: the orchestrator needs to request a longer `timeoutMs` for image children, or the default subagent timeout policy needs to be revisited for slow image-generation tasks.