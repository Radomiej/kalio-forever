# Playwright testing skill

## What was done

- Added a new workspace skill at `.github/skills/playwright-testing/SKILL.md`.
- Scoped the skill to Kalio-specific Playwright work: real E2E specs and manual Playwright MCP verification.
- Documented the stable `data-testid` map for app shell navigation, Talk, Personas, Skills, Landing, confirmations, and active loop stop controls.
- Captured repo-specific testing patterns: seed state via API, assert panel anchors after navigation, prefer state-based streaming assertions, and treat failed clicks as a re-orientation point instead of continuing blindly.
- Included existing repo anchors so future agents can reuse real examples from `apps/e2e/tests/` rather than invent selectors or flow structure.

## Files touched

- `.github/skills/playwright-testing/SKILL.md`

## Decisions made

- Kept the customization workspace-scoped because the skill is tightly coupled to Kalio UI structure, local URLs, and repo-specific `data-testid` names.
- Wrote one skill instead of instructions because this behavior is task-specific, not something that should load into every coding turn.
- Included both Playwright spec and manual MCP guidance, since this repo uses both and agents were drifting between them.

## Validation

- Verified the new file exists in `.github/skills/playwright-testing/`.
- Read back the generated frontmatter and body.
- VS Code diagnostics for `.github/skills/playwright-testing/SKILL.md`: no errors.

## Open questions

- None for the skill itself.

## Next steps

- If needed, add a second skill focused only on manual browser debugging of streaming/subagent flows, but the new skill should already cover the common navigation and click-orientation problems.