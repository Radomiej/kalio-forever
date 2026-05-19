# 2026-05-18 12:44 - ProjectPlanner CLI smoke test

## What was done

- Verified live Kalio health via `GET /api/health`.
- Verified `GET /api/allowed-paths` includes `C:\Projekty`, so `C:\Projekty\ProjectPlanner` is now allowed through the parent-root rule.
- Verified the target repository exists and inspected its top-level structure.
- Ran the same repo-description question directly through Gemini CLI, GitHub Copilot CLI, and Codex CLI using commands close to Kalio adapter invocations.

## Results

- Gemini CLI succeeded and identified ProjectPlanner as an AI-powered project management app using React 19, Vite, Tailwind CSS v4, Zustand, and Google Generative AI.
- GitHub Copilot CLI succeeded and identified the project as Project Planner AI with a React + Vite + Express stack and Google Drive / Gemini integration.
- Codex CLI failed for an external reason: usage limit reached (`You've hit your usage limit`). This was not an Allowed Paths failure and not a repo-access failure.

## Validation

- `http://localhost:3016/api/health` returned `{ status: 'ok' }`
- `http://localhost:3016/api/allowed-paths` returned a parent root covering `C:\Projekty\ProjectPlanner`
- Direct CLI commands succeeded for Gemini and Copilot
- Direct Codex command failed with quota/usage-limit message

## Open questions

- This pass validated direct CLI execution plus Kalio runtime preconditions, but it did not run a full Socket.IO chat round-trip through Kalio orchestration.
- Codex needs quota reset or a different authenticated account before the same smoke test can pass there.

## Next steps

- Retry the Codex smoke test after the usage window resets.
- If needed, run the same repo-description prompt through a full Kalio chat/session flow to validate parent-agent orchestration on top of the now-fixed Allowed Paths behavior.