# Xiaomi Live Tool Progress Validation

## What was done

- Validated the user-provided Xiaomi MiMo key against the live backend credential probe.
- Re-ran `apps/e2e/tests/live-tool-arg-progress.spec.ts` against Xiaomi on the existing dev stack (`3016` API / `5188` web).
- Re-ran the UI-only live Playwright assertion separately to distinguish socket-level `tool:arg_progress` support from fallback UI visibility.
- Attempted a clean dedicated-stack rerun on `3316/5288`, but the stack bootstrap failed due to unrelated backend build errors in `hitl-config.*.spec.ts`.

## Results

- Credential probe succeeded: `/api/credentials/test` returned `{ ok: true, latencyMs: 2948 }` for Xiaomi MiMo.
- Live Playwright credential test also passed.
- Live socket test failed: no `tool:arg_progress` event was observed before `tool:start` / `tool:confirmation_required`.
- Live UI test failed: no `Preparing/Writing raapp_create` indicator text was observed on the tested `3016/5188` stack.

## Interpretation

- The Xiaomi key is valid.
- The shared backend provider code path supports Xiaomi because `XiaomiMiMoProvider` extends `BaseOpenAICompatibleProvider`.
- In the observed live Xiaomi run, that provider did not yield the streamed `tool_calls.function.arguments` deltas needed for `tool:arg_progress`.
- On the tested dev stack, the fallback UI path was also not observed live for Xiaomi.
- A clean dedicated rerun was blocked by unrelated backend build failures, so the failed UI observation is confirmed on the active dev stack, not yet on an isolated dedicated stack.

## Commands run

- Direct credential probe against `http://localhost:3016/api/credentials/test`
- `npx playwright test tests/live-tool-arg-progress.spec.ts --project=chromium --reporter=list`
- `npx playwright test tests/live-tool-arg-progress.spec.ts --project=chromium --reporter=list -g "web chat renders tool intent or progress text before tool:start with the live provider"`

## Open questions

- Whether Xiaomi truly never streams tool argument deltas for this prompt/model, or whether the active `3016/5188` dev stack differs materially from the previously validated dedicated-stack environment.
- Whether the missing fallback UI on `3016/5188` is a provider behavior issue, a stack freshness issue, or a separate regression masked by the dedicated-stack bootstrap failure.