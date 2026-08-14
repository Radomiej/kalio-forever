# Fail-Fast Drizzle Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make database migrations the sole schema authority and stop Kalio startup whenever migration state is invalid.

**Architecture:** `DrizzleService` opens SQLite with WAL and foreign keys, runs Drizzle migrations, and lets every migration failure abort Nest bootstrap. Schema fields missing from the journal are added through a generated Drizzle migration. Existing drifted databases are handled only by an explicit backup-and-reset CLI, never by application startup.

**Tech Stack:** NestJS 11, TypeScript, better-sqlite3, Drizzle ORM/Kit, Vitest, Node.js test runner.

## Global Constraints

- Keep `DATABASE_PATH`, WAL, and foreign-key behavior unchanged.
- Do not change shared contracts in `packages/@kalio/types/**`.
- Do not access real credentials or perform live-provider calls.
- Runtime bootstrap must not execute schema-repair `ALTER TABLE` or `CREATE TABLE` statements.
- A destructive reset requires an explicit confirmation flag and creates a backup before removal.

---

### Task 1: Prove migration behavior before changing production code

**Files:**
- Modify: `apps/kalio-api/src/database/drizzle.service.spec.ts`

- [ ] Add a fresh-database test that runs `migrate()` directly and asserts `agent_flow_runs.parent_tool_call_id`, `messages.turn_id`, and `messages.prompt_message_id` exist.
- [ ] Add an upgrade test that migrates through journal `0017`, then runs the full folder and asserts the same three fields exist.
- [ ] Add a bootstrap test that removes the latest journal row from an otherwise migrated database and asserts `DrizzleService.onModuleInit()` throws the duplicate-column migration error.
- [ ] Run the focused test and confirm it fails because migrations are incomplete and bootstrap suppresses the error.

### Task 2: Make Drizzle the only schema migrator

**Files:**
- Modify: `apps/kalio-api/src/database/drizzle.service.ts`
- Generate: `apps/kalio-api/src/database/migrations/0018_*.sql`
- Modify: `apps/kalio-api/src/database/migrations/meta/_journal.json`
- Generate: matching Drizzle meta snapshot

- [ ] Run `pnpm --filter kalio-api db:generate` using system Node to generate the migration from schema/journal drift.
- [ ] Verify the generated SQL adds exactly the three missing columns and no unrelated schema changes.
- [ ] Remove the migration `try/catch`, drift detection, and all `ensure*` runtime repair methods from `DrizzleService` while preserving SQLite setup and migration logs.
- [ ] Re-run the focused test and confirm it passes.

### Task 3: Provide an explicit backup-and-reset path

**Files:**
- Create: `scripts/reset-kalio-db.mjs`
- Create: `scripts/reset-kalio-db.test.mjs`
- Modify: `package.json`

- [ ] Add failing Node tests for missing confirmation, backup creation, removal of SQLite database/WAL/SHM files, and refusing paths outside the repository `data` directory.
- [ ] Add `db:reset` script requiring `--database <path> --confirm-reset`; it copies the database sidecar set to a timestamped backup directory before deletion.
- [ ] Re-run the script tests and confirm they pass.

### Task 4: Verify and document the migration boundary

**Files:**
- Create: `docs/sessions/2026-07-13-fail-fast-drizzle-migrations.md`

- [ ] Run focused database and reset-script tests, API typecheck, API build, and the root test gate where feasible.
- [ ] Record commands, results, reset operational constraint (stop Kalio before reset), and any unrelated blockers in the session note.
