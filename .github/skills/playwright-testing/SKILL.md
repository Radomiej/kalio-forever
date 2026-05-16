---
name: playwright-testing
description: "Playwright testing skill for Kalio-Forever. Use when: writing or debugging Playwright E2E specs, doing manual browser verification with Playwright MCP, figuring out what to click in Talk, Mind, Personas, Skills, Landing, RA-App, streaming, confirmations, or agent-loop stop flows, or when an agent is getting lost in the UI."
argument-hint: "Optional focus area: 'talk', 'mind', 'personas', 'skills', 'landing', 'raapp', 'streaming', 'manual-mcp', 'e2e-spec'"
---

# Playwright Testing — Kalio-Forever

Use this skill to test Kalio through either:

- real Playwright specs in `apps/e2e/tests/`
- manual browser verification with Playwright MCP tools

The goal is not just "use Playwright". The goal is to keep the agent oriented in the actual UI, use stable selectors, seed deterministic state, and avoid getting stuck on the wrong panel or the wrong session.

## Start Here

1. Read [AGENTS.md](../../../AGENTS.md) and [copilot-instructions.md](../../copilot-instructions.md) for repo rules.
2. Decide the mode:
   - **`e2e-spec`**: add or update a real spec in `apps/e2e/tests/`
   - **`manual-mcp`**: verify the live app through browser tools without editing test files
3. Prefer the smallest realistic slice. Do not test the whole app when the ask is about one flow.

## Environment Rules

- Web app URL: `http://localhost:5188`
- API base for tests: `http://localhost:3016/api`
- Shared helper: [apps/e2e/tests/helpers/test-config.ts](../../../apps/e2e/tests/helpers/test-config.ts)
- Playwright config: [apps/e2e/playwright.config.ts](../../../apps/e2e/playwright.config.ts)

Use `./start-dev.ps1` from repo root before live browser verification.

On Windows, do not invent your own frontend launch wrapper that redirects stdout/stderr. This repo already documents a Vite/Tailwind crash when frontend output is piped. Use the existing startup flow instead of background wrappers that capture FE output.

## Core Principles

### 1. Use stable selectors first

Always prefer:

- `page.getByTestId(...)`
- `filter({ hasText: ... })`
- regex test ids for repeated tiles/items

Avoid:

- raw CSS selectors tied to layout
- nth-child selectors unless the order itself is what you are testing
- clicking generic snapshot nodes just because they are visible

### 2. Seed state through the API when possible

If a test needs a session, persona, skill, or other entity, create it via `request` first, then navigate to it in the UI.

This is the house pattern in existing specs.

Why:

- less click drift
- deterministic titles and ids
- easier cleanup
- avoids agents getting lost in long lists

### 3. Assert screen anchors after every navigation step

Do not chain many clicks blindly.

After a navigation click, assert the expected anchor before continuing. Examples:

- Talk opened -> `chat-interface`
- Mind -> Personas opened -> `persona-panel` or `new-persona-btn`
- Mind -> Skills opened -> `new-skill-btn` and `skill-editor`
- Landing opened -> `landing-page`

### 4. For streaming flows, assert state transitions, not just text

Prefer checks like:

- input becomes disabled during streaming
- stop button appears while streaming
- input becomes enabled again after completion
- user message count stays `1` under anti-spam conditions

Avoid relying only on one final assistant string when the behavior under test is about live state.

### 5. If a click fails, stop and re-orient

For manual MCP runs:

1. take a fresh snapshot
2. confirm you are on the intended panel
3. verify the target still exists
4. retry once with the exact current ref
5. only then consider a code/evaluate fallback

Do not continue the scenario on a stale page model.

## Kalio UI Map

### App Shell

Navigation buttons in [apps/kalio-web/src/App.tsx](../../../apps/kalio-web/src/App.tsx):

- `nav-home`
- `nav-talk`
- `nav-tools`
- `nav-mind`
- `nav-observe`
- `nav-settings`

Mind tabs in [apps/kalio-web/src/App.tsx](../../../apps/kalio-web/src/App.tsx):

- `mind-tab-memory`
- `mind-tab-files`
- `mind-tab-skills`
- `mind-tab-personas`

### Talk / Chat

Primary anchors:

- `chat-interface`
- `welcome-persona-select`
- `chat-input`
- `chat-send-btn`
- `chat-stop-btn`
- `session-item`
- `canvas-panel`

Useful content selectors:

- user bubbles: `[data-testid="message-bubble"][data-role="user"]`
- agent turn bubble: `agent-turn-bubble`
- tool confirmation buttons:
  - `confirmation-confirm-btn`
  - `confirmation-cancel-btn`

Running loop controls in [apps/kalio-web/src/features/sessions/ConversationManagerPanel.tsx](../../../apps/kalio-web/src/features/sessions/ConversationManagerPanel.tsx):

- `active-loop-${sessionId}`
- `stop-loop-${sessionId}`

### Personas

Selectors from [apps/kalio-web/src/features/persona/PersonaPanel.tsx](../../../apps/kalio-web/src/features/persona/PersonaPanel.tsx):

- `persona-panel`
- `new-persona-btn`
- `persona-item`
- `persona-name-input`
- `persona-model-input`
- `persona-prompt-textarea`
- `persona-tools-toggle`
- `persona-tool-picker`
- `persona-save-btn`
- `persona-delete-btn`

Tool picker examples:

- `group-toggle-vfs`
- `tool-toggle-vfs_read`
- `tool-toggle-memory_search`

### Skills

Selectors from [apps/kalio-web/src/features/skills/SkillListPanel.tsx](../../../apps/kalio-web/src/features/skills/SkillListPanel.tsx) and [apps/kalio-web/src/features/skills/SkillEditorPanel.tsx](../../../apps/kalio-web/src/features/skills/SkillEditorPanel.tsx):

- `new-skill-btn`
- `skill-item`
- `skill-delete-btn`
- `skill-editor`
- `skill-name-input`
- `skill-save-btn`

### Landing / RA-App Entry

Selectors from landing components:

- `landing-page`
- `quick-chat-input`
- `app-tile-${id}`

For generic tile smoke tests, existing specs use `page.getByTestId(/^app-tile-/).first()`.

## Recommended Flow Per Area

### Talk / Streaming

Pattern:

1. create a session via API if deterministic selection matters
2. `page.goto('/')`
3. click `nav-talk`
4. select `session-item` filtered by session title
5. assert `chat-input` is enabled
6. send message
7. assert disabled/enabled transitions or message counts

Use existing specs as anchors:

- [apps/e2e/tests/ac-13-anti-spam.spec.ts](../../../apps/e2e/tests/ac-13-anti-spam.spec.ts)

### Personas

Pattern:

1. `page.goto(APP_URL)`
2. click `nav-mind`
3. click `mind-tab-personas`
4. assert `new-persona-btn`
5. create/edit via stable persona inputs

Use as anchors:

- [apps/e2e/tests/ac-04-persona-tools.spec.ts](../../../apps/e2e/tests/ac-04-persona-tools.spec.ts)

### Skills

Pattern:

1. `page.goto(APP_URL)`
2. click `nav-mind`
3. click `mind-tab-skills`
4. assert `new-skill-btn`
5. create/select item
6. assert `skill-editor`

Use as anchors:

- [apps/e2e/tests/ac-19-skills-ui.spec.ts](../../../apps/e2e/tests/ac-19-skills-ui.spec.ts)

### Landing / RA-App Launch

Pattern:

1. `page.goto('/')`
2. assert `landing-page`
3. target app tiles by test id regex
4. after tile click, assert `chat-interface`

Use as anchors:

- [apps/e2e/tests/ac-10-raapp-rendering.spec.ts](../../../apps/e2e/tests/ac-10-raapp-rendering.spec.ts)

For chat-driven RA-App flows:

- use persona `ra-apps`
- do not rely on implicit inputs; provide all required fields
- for deterministic GUI verification, prefer the seeded `qa-interactive` app

## Waiting Strategy

Prefer:

- `await expect(locator).toBeVisible({ timeout: ... })`
- `await expect(locator).toBeEnabled({ timeout: ... })`
- `await expect(locator).toBeDisabled({ timeout: ... })`
- `await expect(locator).toHaveCount(...)`

Use `page.waitForTimeout(...)` only when the behavior is inherently time-based or when debugging a flaky live browser path. It should not be the primary synchronization mechanism in normal specs.

For streaming and agent runs:

- wait on input/button state changes
- wait on message counts
- wait on tool activity or confirmation controls
- avoid fixed sleeps when an observable UI state exists

## Manual Playwright MCP Procedure

Use this when the user asks for live browser verification instead of a spec.

1. Open or select the correct shared page.
2. Snapshot before the first click.
3. Click one UI boundary at a time.
4. Snapshot again after each boundary change.
5. Read the page state after any streaming/tool event before acting again.

For MCP runs in this repo:

- shell navigation can occasionally fail to produce the expected React state change on the first click
- do not assume the click worked because no error was thrown
- confirm the new panel anchor after the click
- if still wrong, re-snapshot and only then retry or use a last-resort code path

Real manual verification notes live here:

- [docs/sessions/2026-05-02-17-40-subagent-playwright-manual-verification.md](../../../docs/sessions/2026-05-02-17-40-subagent-playwright-manual-verification.md)

## Known Good Patterns

### Seed and select a session

```ts
const res = await request.post(`${API_BASE}/sessions`, {
  data: { title, personaId: 'default' },
});
const session = await res.json() as { id: string };

await page.goto('/');
await page.getByTestId('nav-talk').click();
await page.getByTestId('session-item').filter({ hasText: title }).first().click();
```

### Navigate to Personas

```ts
await page.goto(APP_URL);
await page.getByTestId('nav-mind').click();
await page.getByTestId('mind-tab-personas').click();
await expect(page.getByTestId('new-persona-btn')).toBeVisible();
```

### Navigate to Skills

```ts
await page.goto(APP_URL);
await page.getByTestId('nav-mind').click();
await page.getByTestId('mind-tab-skills').click();
await expect(page.getByTestId('new-skill-btn')).toBeVisible();
```

### Landing tile smoke

```ts
await page.goto('/');
await expect(page.getByTestId('landing-page')).toBeVisible({ timeout: 5000 });
await expect(page.getByTestId(/^app-tile-/).first()).toBeVisible({ timeout: 10_000 });
```

## Anti-Patterns

- Do not click through dozens of sessions manually when you can create one via API and filter by title.
- Do not use text-only selectors for core navigation when a `data-testid` exists.
- Do not keep clicking after the app failed to switch sections.
- Do not write a flaky spec around streaming with only sleeps.
- Do not leave created sessions/personas/skills behind when the test can clean them up.
- Do not use manual MCP verification as a substitute for a regression test when the task is a real bug fix.

## Command Cheatsheet

From repo root:

```powershell
Set-Location apps/e2e
node_modules\.bin\playwright.cmd test tests/ac-04-persona-tools.spec.ts --project=chromium
node_modules\.bin\playwright.cmd test tests/ac-19-skills-ui.spec.ts --project=chromium
node_modules\.bin\playwright.cmd test tests/ac-13-anti-spam.spec.ts --project=chromium
```

Use single-file iteration first. Expand scope only after the touched slice is green.

## Finish Criteria

Before finishing a Playwright task, report:

- which screen/flow was tested
- which selectors or setup strategy were used
- whether the result came from a real spec or manual MCP run
- any UI flakiness or environment issue that remains separate from the requested fix

## References

- [apps/e2e/playwright.config.ts](../../../apps/e2e/playwright.config.ts)
- [apps/e2e/tests/ac-04-persona-tools.spec.ts](../../../apps/e2e/tests/ac-04-persona-tools.spec.ts)
- [apps/e2e/tests/ac-10-raapp-rendering.spec.ts](../../../apps/e2e/tests/ac-10-raapp-rendering.spec.ts)
- [apps/e2e/tests/ac-13-anti-spam.spec.ts](../../../apps/e2e/tests/ac-13-anti-spam.spec.ts)
- [apps/e2e/tests/ac-19-skills-ui.spec.ts](../../../apps/e2e/tests/ac-19-skills-ui.spec.ts)
- [docs/sessions/2026-05-02-17-40-subagent-playwright-manual-verification.md](../../../docs/sessions/2026-05-02-17-40-subagent-playwright-manual-verification.md)