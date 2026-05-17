# Live Comet Tool Arg Progress

## What was done
- Investigated live `tool:arg_progress` behavior on the dedicated stack at `http://localhost:3316` and `http://localhost:5288`.
- Verified the supplied live key against provider test endpoints: `xiaomimimo` failed with `401 Invalid API Key`, while `cometapi` passed.
- Inspected failing Playwright artifacts and found the first false negative came from the model choosing `list_raapps` instead of `raapp_create`.
- Updated the live Playwright spec to use the `designer` persona and an explicit `raapp_create`-only prompt to force the intended tool path.
- Found a second test bug in the probe socket: `ChatGateway` ignored the socket `query.sessionId`, so the extra listener socket needed `session:identify` before it could receive session-scoped events.
- Re-ran the live Comet Playwright probe after the helper fix.

## Files touched
- `apps/e2e/tests/live-tool-arg-progress.spec.ts`

## Decisions
- Kept live verification on `cometapi` because the provided key is valid there.
- Switched the live session persona from `ra-apps` to `designer` to remove `list_raapps` from the tool surface and force direct `raapp_create`.
- Left Xiaomi live verification blocked on credentials instead of trying to work around the provider rejecting the key.

## Findings
- In the live Comet run, the web UI reaches `raapp_create` and shows `awaiting confirmation` with generated HTML content.
- No visible `Preparing ...` or `Writing ...` indicator appeared before the tool confirmation bubble.
- The live socket/UI probe still did not observe `tool:arg_progress` before the `raapp_create` confirmation/start phase.
- Current evidence points to the live Comet `gpt-4o-mini` path not surfacing incremental tool-argument deltas for this scenario, despite unit coverage proving the parser and event path work when such deltas exist.

## Open questions
- A raw same-socket backend probe would remove the last bit of uncertainty about probe-socket routing vs provider streaming, though the current UI evidence already shows no user-visible pre-start progress in the live Comet path.
- If live providers only emit the full tool call at once, the product may need a fallback heuristic instead of depending on streamed argument deltas.

## Next steps
- Add temporary backend debug logging around `onToolArgChunk` for a real Comet run, or capture raw SSE from the provider to confirm whether `tool_calls[].function.arguments` arrives incrementally.
- Consider a fallback UX that shows at least a synthetic `Preparing <tool>...` state on early tool intent when providers do not stream argument chunks.
