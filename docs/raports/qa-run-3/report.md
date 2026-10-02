# QA run 3 — stable QA and local Devin SWE-2

Date: 2026-09-26  
Status: preparation complete; waiting for explicit action-time approval to enable the persona's scoped MCP allowlist. No Devin prompt has been submitted in this run.

## Scope and safety

- Kalio checkout: `C:\Users\Radomiej\.codex\worktrees\5a7e\kalio-forever`; `git status --short` showed 64 changed paths before this report. Existing work was preserved; nothing was reset, stashed, staged, or committed.
- Stable QA: UI `http://localhost:5288/`, API `http://127.0.0.1:3316/api`; profile `qa`, data root `C:\Users\Radomiej\AppData\Local\kalio-forever-qa`, DB `kalio-qa.db`, workspace `workspaces`.
- `pnpm qa` rebuilt and restarted this worktree's stable QA. Backend build: 638 files compiled, 0 type issues. Frontend build passed with a non-blocking large-chunk warning (2.09 MB JS before gzip). `pnpm qa:status` confirmed both fixed-port services healthy and provider `mock/mock`, source `env`.
- Dev-servers MCP inventory calls returned `fetch failed`; the repository QA status command confirmed the actual stack and AppData paths. No claim that QA is a Windows service.
- Devin CLI: `3000.11.1`, executable `C:\Users\Radomiej\AppData\Local\devin\cli\bin\devin.exe`. Fresh catalog marks exact model `swe-2-high` `Free` (262K context); model `swe-2-medium` is also free. The selected persona is `Devin SWE-2 QA`, execution source `Devin CLI (host)`, model `swe-2-high`.
- Kalio's provider was not changed. The static readiness check against `http://127.0.0.1:3316/api` failed four paid/live-provider gates: provider `mock`, config source `env`, no saved live credentials, no active credential. It passed endpoint reachability, no stale AgentFlow runs, and no recent provider failures. No completion or Web Search smoke call ran. This is recorded, not bypassed by changing provider.
- Target `E:\Projekty\home-site` existed and was empty at preflight. Existing Kalio project `Home Site` points exactly there. No project files have been written.
- Devin persona has exactly six selected Kalio tools: `fs_list`, `fs_read`, `fs_write`, `terminal_spawn`, `terminal_list`, `terminal_output`; native filesystem/web/terminal remain off. However, the current MCP policy is `Deny all`, so those selected tools cannot execute. The UI presents an `Allow list` option. Waiting for approval to enable only that exact allowlist; `fs_write` and `terminal_spawn` must still be approved individually at their action prompts.
- A bounded fictional-company React + TypeScript request is staged in Kalio Talk with Devin SWE-2 QA and Home Site selected, but not submitted. VS Code Bridge remains off.
- Browser: Codex in-app browser, 1280×720. Screenshot saved: [`01-qa-after-rebuild.png`](assets/01-qa-after-rebuild.png). The report screenshot shows the rebuilt local QA home. The settings/policy and Talk draft were inspected live; no separate screenshot file for them has been saved yet.

## Pre-run process sample

One read-only, bounded `Win32_Process` sample at `2026-09-26T10:46:22Z` (12:46:22 Europe/Warsaw), before any Devin run in this attempt, counted 74 `cmd.exe` processes. The first 30 by creation time included Codex-owned MCP launchers (including repeated Codex Security/Codex app tools and Context7 launchers), Chrome native hosts, OpenClaw, and unrelated local dev servers. No Devin process appeared in those 30 sampled rows. Command-line values matching common token/password/key/secret patterns were redacted. This is correlation only: it does not attribute all 74 processes or prove a leak. No process was terminated. A second bounded sample is needed after the Devin action to compare; do not repeatedly poll.

## Acceptance matrix

| AC | Requirement | Status | Evidence / remaining |
|---|---|---|---|
| AC-01 | Fixed QA profile healthy | PASS | `pnpm qa`, then `pnpm qa:status`; API/frontend healthy on 3316/5288, isolated AppData root retained. |
| AC-02 | QA provider known and unchanged | PASS | `/api/llm/config` and stack status: `mock/mock`, source `env`; no provider switch. |
| AC-03 | Exact free SWE-2 model available | PASS | Fresh local `devin models list`: `swe-2-high [262K context, Free]`; persona selects `swe-2-high`. |
| AC-04 | Exact target safe | PASS | `E:\Projekty\home-site` was empty; UI project `Home Site` resolves to that path. |
| AC-05 | MCP execution policy matches approved scope | BLOCKED | Six exact tools are checked, but UI policy is `Deny all`; no prompt sent pending action-time approval to switch to `Allow list`. |
| AC-06 | Real Devin run from Kalio Talk | BLOCKED | Persona/project/request are selected/staged; no run in attempt 3 yet. |
| AC-07 | Scoped writes, local build, desktop/mobile browser checks, F5 recovery of completed run | NOT RUN | Requires a real run and per-action review of any `fs_write`/`terminal_spawn` requests. |
| AC-08 | Screenshot evidence | PARTIAL | One QA-home screenshot is saved under `assets/`; settings, graph/audit and generated-page screenshots remain outstanding. |
| AC-09 | Earlier `cmd.exe` burst attribution | UNVERIFIED | Baseline is 74 with multiple unrelated owners; no post-Devin sample yet. Do not kill unknown/shared processes. |

## Current blocker and next action

The run is paused before prompt submission because the saved persona policy contradicts its six checked tools. If authorized, switch only that persona to `Allow list`, verify the six-tool set and native-tool-off state after saving, then submit exactly one SWE-2 run through Talk. Review each pending write/build action against the exact path and request before approving it. After terminal completion, verify graph/tool counts and ACP approval events, re-check project files, run the generated app's local build, inspect desktop/mobile previews and F5 recovery, save those screenshots, and take one bounded post-run `cmd.exe` sample. Do not change Kalio's LLM provider or infer success from model prose.
