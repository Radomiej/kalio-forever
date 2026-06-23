# Kalio Browser MCP QA Skill

Installed skill path:

```text
C:\Users\Radomiej\.codex\skills\kalio-browser-mcp-qa\SKILL.md
```

This repository copy records the expected behavior for agents that test Kalio through browser MCP tooling.

## Core Rule

Use browser MCPs to prove the user-visible path first, then support the conclusion with API, terminal, and log evidence. Do not treat a green backend health check as proof that chat or workflow works.

## Tool Choice

Use this decision rule:

1. Use **Playwright E2E on a managed stack** when you need a release gate, repeatable workflow proof, reconnect/F5 proof, or anything that must pass 100%.
2. Use **Playwright Orchestrator MCP** when you need live exploratory QA, screenshots, DOM inspection, or quick smoke on an already running Kalio stack.
3. Use **Chrome MCP** only as a supporting manual-debug surface when you need Chrome-specific behavior, existing-profile state, or DevTools-like inspection.
4. If Chrome MCP shows localhost bootstrap network errors, stop treating it as the primary QA path for pass/fail decisions and fall back to Playwright.

## Required Setup

1. Read `AGENTS.md`, `docs/local-dev-guide.md`, and `docs/agent-skills/kalio-manual-qa.md`.
2. Start the right stack:
   - **Dev hot reload:** `.\start-dev.ps1` -> API `3016`, web `5188`
   - **Built QA fixed ports:** `pnpm qa` or `pnpm qa:rebuild` -> API `3316`, web `5288`
   - **Managed isolated QA:** `node scripts/stack-manager.mjs start --backend-port 0 --frontend-port 0`
3. Confirm the effective provider before live workflow testing:
   - `GET /api/llm/config`
   - reject the run if DB or `.env` silently switched the provider/model away from the intended target.
4. Prefer `127.0.0.1` for local URLs when testing browser MCP connectivity. This is an automation-specific fallback; ordinary manual browser QA can use `localhost`, and both origins must keep working.

## Reliable Test Paths

### A. Release / Repeatable Gate

Use Playwright E2E against a built or managed QA stack.

Minimum proof:

- open Kalio
- start the target chat/workflow from the UI
- verify session appears without manual refresh
- verify child sessions / timeline / canvas state
- reload during or after the run and verify hydration
- verify final visible output

Use this path for:

- normal chat
- workflow branching
- reconnect / offline recovery
- session hydration
- release gating

### B. Interactive Smoke / Investigation

Use Playwright Orchestrator MCP on an already running stack.

Minimum proof:

- create browser session
- open page
- confirm title, URL, and visible shell
- inspect console and DOM if behavior looks wrong
- take screenshots for evidence

This is valid for:

- smoke that the app opens
- verifying visible panels, badges, graph nodes, and placeholders
- capturing QA evidence while debugging

This is not enough alone for:

- final release sign-off
- workflow completion claims
- reconnect durability claims

### C. Chrome-Specific Debugging

Use Chrome MCP only when Chrome-specific state matters.

Known local limitation from `2026-06-22`:

- Chrome MCP opened Kalio on localhost, but bootstrap API calls failed in the extension runtime with repeated `AxiosError: Network Error`.
- Visible symptoms:
  - session panel load failed
  - bootstrap runtime load failed
  - architecture registry load failed
  - personas load failed

Interpretation:

- Chrome MCP is useful here for observing console/runtime failures.
- Chrome MCP is not currently a trustworthy primary pass/fail gate for local Kalio QA on this machine.

## Scenario Matrix

| Scenario | Primary path | Secondary evidence | Pass condition |
| --- | --- | --- | --- |
| App opens | Playwright Orchestrator MCP | API health, screenshot | Shell renders, no fatal bootstrap failure |
| New chat/session responsiveness | Playwright E2E | network/log inspection | Session opens quickly without loading all history |
| Workflow branch visibility | Playwright E2E | API run status, screenshots | Sidebar, Talk, and Canvas agree on child visibility |
| Child pending/running states | Playwright Orchestrator MCP | host trace / runtime snapshot | Placeholder shows current activity, not empty dead state |
| Reconnect/F5 hydration | Playwright E2E | API snapshot before/after reconnect | UI rebuilds from backend state without stale status |
| Chrome-specific regression | Chrome MCP | Playwright comparison | issue reproduced or disproved in Chrome runtime |

## Required Checks For Workflow QA

When testing workflow, do all of these:

1. Start from the FE, not a raw API call.
2. Verify the root conversation appears in Talk.
3. Verify expected child sessions appear in the sidebar.
4. Verify the Canvas / execution view shows current and pending stages.
5. Open at least one child session and confirm it shows either persisted output or a live activity summary.
6. Reload and confirm the same workflow reconstructs.
7. Confirm finalizer/final artifact becomes visible when the run completes.

## Failure Rules

Treat these as real QA failures:

- session stuck on infinite loading
- empty child session with no live activity hint
- `running` badge that survives after terminal backend state
- workflow finalizer acting like a researcher and scanning files instead of merging inputs
- Chrome/Playwright shell opens but bootstrap requests fail
- pass claim based only on `/api/health` or run polling

## Evidence Standard

Do not claim "works" without:

- browser action evidence
- screenshot or DOM proof for the relevant panel
- verification command(s)
- stack URL/port used
- whether proof came from Playwright E2E, Playwright Orchestrator MCP, or Chrome MCP

If Chrome MCP disagrees with Playwright, report the split explicitly and prefer the more reliable path for release gating.
