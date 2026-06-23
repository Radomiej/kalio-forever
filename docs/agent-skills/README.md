# Kalio Agent Skill Copies

This directory is the repo-visible copy of Kalio-specific Codex skills. Installed skill files live under:

```text
C:\Users\Radomiej\.codex\skills\<skill-name>\SKILL.md
```

## Sync Rule

- Treat the repo copy as the reviewed canonical text for this project.
- When a repo skill copy changes, sync the matching installed `SKILL.md` before relying on the new behavior in another Codex session.
- If installed and repo copies differ, report the drift in the session result and do not assume future agents will see the repo-only update.
- `kalio-browser-mcp-qa` may intentionally be absent from older sessions; use the repo copy as fallback instructions when the installed skill is missing.

## Current Project Skills

- `ast-grep-kalio-structural-search`
- `kalio-architecture-runtime-guard`
- `kalio-browser-mcp-qa`
- `kalio-manual-qa`
- `serena-kalio-code-navigation`
