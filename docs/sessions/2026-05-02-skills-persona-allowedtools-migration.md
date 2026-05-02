# Session: Skills/Persona AllowedTools Migration

**Date**: 2026-05-02  
**Scope**: `@kalio/types`, `kalio-api`, `kalio-web`, E2E specs

## What Was Done

### Problem
`Persona.skills` was ambiguously named — it actually stored native tool names (allowlist), not `Skill` entity IDs. `Skill.prompt` was stored in DB but never injected anywhere (dead data).

### Changes

#### @kalio/types
- `Persona.skills` → `Persona.allowedTools` (tool name allowlist)
- Added `Persona.skillIds: string[]` (IDs of Skill entities to inject)
- Same renames in `CreatePersonaDto`, `UpdatePersonaDto`
- `PersonaSessionConfig.availableSkills` → `allowedTools`, added `skillIds`

#### DB
- `apps/kalio-api/src/database/schema.ts`: column `skills` → `allowed_tools`, new `skill_ids` column
- New migration `0006_persona_allowed_tools.sql`

#### Backend
- `persona.service.ts`: all `skills`→`allowedTools`, added `skillIds` in mapRow, getSessionConfig, bootstrap seed/update
- `personas.json` (seed data): `"skills"` → `"allowedTools"`, `"skillIds": []` added to all 5 entries
- `skills.service.ts`: added `findByIds(ids: string[]): Promise<Skill[]>` helper
- `chat.service.ts`: injected `SkillsService`, changed tool filter call to `allowedTools`, added skill prompt auto-injection into system prompt as `## Active skills` section
- `chat.module.ts`: added `SkillsModule` to imports

#### Tool layer
- `skill.tools.ts`: added `SkillReadTool` (`skill_read`) — looks up skill by ID or name, returns full prompt
- `persona.tools.ts`: all 4 persona tools updated (`allowedTools`+`skillIds` params)
- `tool-registry.service.ts`: added `SkillReadTool` injection
- `tool.module.ts`: added `SkillReadTool` to providers

#### Frontend
- `PersonaPanel.tsx`: `skills`→`allowedTools` state, DTOs, and UI references
- `PersonasPanel.tsx` (settings): `EditForm.skills`→`allowedTools`, all `form.skills`→`form.allowedTools`
- `SessionPanel.test.tsx`: mock persona fixture `skills`→`allowedTools`+`skillIds`

#### Tests
- `contracts.test.ts`: updated Persona test for `allowedTools`+`skillIds`
- E2E specs: `ac-04-persona-crud`, `ac-04-persona-tools`, `ac-11-persona-system-prompt` — `skills`→`allowedTools`
- `persona.service.spec.ts`: all mock rows and assertions updated
- `persona.controller.spec.ts`: DTO fixture updated
- `kv-store.service.spec.ts`: inline SQLite schema `skills`→`allowed_tools`+`skill_ids`
- `agent-loop-limits.spec.ts`: added `SkillsService` mock to ChatService constructor
- `issues-verification.spec.ts`: added `SkillsService` provider to NestJS test module

## Result
- Both `kalio-api` and `kalio-web` typecheck clean (exit 0)
- Test suite: 54 pre-existing failures → 34 failures (net improvement: +20 tests passing)
- Zero regressions introduced

## Architecture Decision
Skill injection uses **auto-inject on turn start** model: all skills linked via `persona.skillIds` are fetched at the start of `handleTurn` and their prompts are prepended to the system prompt as an `## Active skills` section. `skill_read` tool exists for on-demand discovery by the agent.
