# Manual Playwright QA - subagents and CLI agents

## What I did

- Opened the live app at http://localhost:5188 and verified baseline startup.
- Checked Settings -> CLI Agents: Copilot, Gemini, Claude, and Codex were detected and enabled.
- Checked Settings -> Allowed Paths: `C:\Projekty` was already present, so `C:\Projekty\ProjectPlanner` was in scope.
- In Talk, created a fresh Orchestrator chat and tested direct `run_cli_agent` with Gemini against `C:\Projekty\ProjectPlanner` in read-only mode.
- In Talk, created a fresh Orchestrator chat and tested `run_subagent` where the child was instructed to call `run_cli_agent` with Gemini on `C:\Projekty\ProjectPlanner`.
- In Talk, created a third Orchestrator chat and tested a minimal `run_subagent` with no nested tools.

## Results

### Passed

- Baseline UI loaded without startup console errors.
- Direct `run_cli_agent` with Gemini on `C:\Projekty\ProjectPlanner` succeeded.
- Simple `run_subagent` without nested tools succeeded.
- Canvas showed subagent cards and allowed opening the child chat.

### Failed / suspicious

- Nested `run_subagent -> run_cli_agent` did not execute the child CLI tool correctly.
- The parent result claimed the child called `run_cli_agent`, but the child session transcript contained only raw `<tool_call>` XML instead of a real CLI result.
- Opening the broken child chat produced React console errors for unknown tags: `agentid`, `workdir`, `prompt`, `parameters`.
- In the broken child session, the session stats showed only 2 messages (1 user, 1 assistant), which is consistent with the CLI tool never actually dispatching.

## Files touched

- `docs/sessions/2026-05-18-13-04-manual-playwright-subagent-cli-qa.md`

## Decisions

- Treated direct CLI success and simple subagent success as control cases.
- Narrowed the defect scope to nested child tool execution/rendering for `run_subagent -> run_cli_agent`.

## Open questions

- Is the child model outputting raw tool-call XML that the backend fails to convert into a real tool dispatch?
- Is the child chat renderer mistakenly treating raw XML as renderable HTML/markup instead of escaped text?
- Should nested child tool calls be blocked explicitly when unsupported, instead of surfacing malformed XML in chat?

## Next steps

- Reproduce with an automated regression test covering `run_subagent` whose child emits `run_cli_agent`.
- Trace backend child-session tool dispatch to confirm whether no child `tool:start` event is emitted.
- Fix frontend rendering so raw tool-call XML cannot create React unknown-tag errors in child chats.
