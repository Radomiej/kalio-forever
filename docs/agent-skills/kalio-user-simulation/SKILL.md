---
name: kalio-user-simulation
description: Simulate a user creating and validating a project through Kalio's web UI, especially with Devin CLI ACP and a freshly verified free SWE-2 model.
---

# Kalio User Simulation

Use this skill when the requested proof is a real user journey through Kalio, not an API-only smoke test. The repo copy is canonical; discover it from `docs/agent-skills/README.md`.

## Guardrails

- Work in the exact project folder the user named or approved. Check it first. If it contains user work, stop before reusing or overwriting it.
- Keep Kalio's repository, generated project, and runtime data separate. Do not patch generated output by hand; send defects back through Kalio.
- Preserve pre-existing Git changes. Never reset, stash, clean, or stage unrelated files.
- Use Chrome or the in-app browser for web flows. Do not switch to native Windows UI automation when a browser surface is available.
- Treat a visible model label as configuration, not runtime attestation. If the run itself, its runtime metadata, or process evidence identifies a different model, reject pending filesystem/terminal approvals and stop the run; do not retry on another provider or model.
- Treat user-provided business details as authoritative. If none were supplied, clearly label fictional copy and use placeholders instead of invented real contact details.
- Do not expose credentials, enable unrelated integrations, deploy, publish, commit, or delete user files. Stop for approval if the next action materially exceeds the requested scope.

## Prepare the runtime

1. Read the repository `AGENTS.md`, `docs/local-dev-guide.md`, `docs/agent-skills/kalio-manual-qa.md`, and, for a live CLI/AgentFlow run, `docs/agentflow-paid-run-readiness-checklist.md`.
2. Record the checkout, `git status --short`, target folder, viewport, and whether the app is mock or live. Do not use production as a QA target.
3. Choose the QA profile the user requested. For the stable built profile, use the system Node on Windows and preserve its fixed ports and AppData root:

   ```powershell
   $env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
   pnpm qa
   ```

   Stable QA uses UI/API ports 5288/3316 and data under `%LOCALAPPDATA%\kalio-forever-qa`. Use `pnpm stack:start` with random ports only when a disposable profile is needed or the user requests it; keep its data root separate and record the URLs it returns. Never substitute dev or production ports.
4. Before any paid/live LLM or CLI-agent run, pass the affected regressions, typechecks/builds, applicable mock E2E, and every hard gate in `docs/agentflow-paid-run-readiness-checklist.md`. Run its `--static-only` readiness check against the exact QA API. A `[Free]` model label alone does not waive the checklist. If a user explicitly authorizes one local free Devin ACP canary despite a red provider gate, do not change Kalio's effective provider or start paid calls; record the failed gate and exact one-run scope, and require fresh authorization for another run.
5. Verify `/api/llm/config` and Settings → LLM Settings on the selected QA API. Record provider, model, and source. Mock proves only mock behavior; do not claim a Devin run from model availability alone.

## Select Devin and a free model

1. Check the installed executable and current catalog without starting a session:

   ```powershell
   devin --version
   devin models list
   ```

2. For coding tasks in this Kalio workspace, prefer Devin first and Codex second, unless the user explicitly chooses otherwise. Never silently switch providers.
3. Choose an exact Devin model ID only when the current catalog marks that exact ID `Free`. For the SWE-2 lane, `swe-2-high` is the normal choice when it is currently marked `[Free]`; `swe-2-medium` and `swe-2-max` are alternatives only when the user or task calls for them. Do not infer that the CLI alias `swe`, Devin Desktop pricing, or an older catalog makes a CLI model free.
4. In Kalio, select the Devin CLI/ACP runtime and exact model in visible profile/project controls. Confirm provider/model and catalog freshness before sending. If status is transiently `Unavailable`, use one explicit UI Recheck; proceed only if the runtime and exact model become available. Record the initial failure and recheck result. Disable model/provider fallback; if the UI/catalog cannot prove the selection and its `Free` marker, stop before submitting.
5. Keep Devin's native filesystem, web, and terminal access at the existing least-privilege settings. Use Kalio's scoped tools and approval flow; approve only operations clearly confined to the approved project directory.
6. Do not generate/rotate a bridge token, trust a project path, or widen tool access unless the user has authorized that exact scope and the applicable action-time confirmation is satisfied. Keep native filesystem/web/terminal switches off when the approved workflow uses only Kalio MCP tools. Treat each Kalio `fs_write` or `terminal_spawn` request as a separate approval; do not infer approval from the persona allowlist.

## Drive the user's project flow

1. Open the selected QA URL in the in-app browser or Chrome and record the exact URL and viewport.
2. Create the conversation first with Kalio's **New** action. Then select the persona/provider and project before sending a prompt; a welcome/launch form without a created session may clear the prompt without starting a run. Confirm the created session and selected project in Talk.
3. Create/open the project through Kalio's UI and set its root to the exact approved empty folder. Do not create source files manually or open the Kalio repository as the demo project.
4. Submit one bounded request that states the company, language, React/TypeScript requirement, required sections, responsive/accessibility expectations, and local build check. Exclude secrets, real personal data, external services, paid add-ons, commits, and deployment.
5. Follow the run in Talk. Inspect pending native-tool approval details before deciding; approve only the exact operation when the model and target scope remain consistent. If it is an AgentFlow run, also inspect Conversations and Execution Graph for the root/child session, tool evidence, and terminal state. API/session/audit inspection is supporting evidence, not a substitute for driving the UI.
6. Verify that runtime evidence agrees with the selected Devin SWE-2 model, that writes stayed inside the approved project, that the run completed rather than merely queued, and that state survives F5/reconnect. Stop or recover through Kalio's UI if the run becomes stuck; do not infer success from a timeout or a worker's claim.
7. Build the generated app and open its local preview in the browser. Check at least a desktop viewport and a narrow mobile viewport; verify the main navigation/CTA, content, keyboard focus, page overflow, and browser console. Record screenshots or equivalent browser evidence.
8. If generated output fails, describe the concrete failing behavior and ask Devin through Kalio to repair it. Re-run the affected build/browser checks; do not edit the generated files yourself.

## Verify Devin ACP Tool Evidence

- Treat assistant prose such as “the user rejected this tool” as unverified. Check the exact session's Execution Graph and audit events before attributing a rejection to a user.
- Record `devin-cli-acp.mcp_bridge` fields (`enabled`, `toolCount`, `transport`, `nativeToolsPolicy`) separately from actual tool execution. A configured bridge does not prove that a tool was listed, approved, or run.
- Reconcile `devin-cli-acp.mcp_approval`, `devin-cli-acp.native_approval`, Kalio HITL events, and graph/tool counts. `native_approval.decision=decline` alone is not proof of a user click; it can be an automatic policy decline. If no allowed Kalio tool call is evidenced, stop and report the run as blocked rather than retrying or enabling Devin-native access.

## Evidence and closure

Create `docs/raports/qa-run-N/report.md` for each attempt (next unused N) and save screenshots in `docs/raports/qa-run-N/assets/`. Record PASS / FAIL / BLOCKED for: exact target path; effective provider and exact model; Free label; UI project creation; completed run and scoped file writes; F5 recovery; build; desktop/mobile browser proof; and any relevant negative/recovery path. Include commands, URLs, viewport, QA profile/data root, source of provider config, screenshot links, and the remaining boundary. If a screenshot or run step is missing, say so explicitly. Distinguish local QA from production and do not claim deployment or release readiness.

Leave a task-owned QA stack running only when it is useful for the user to inspect; otherwise stop it through its own stack manager. Never stop another process to make the test pass.
