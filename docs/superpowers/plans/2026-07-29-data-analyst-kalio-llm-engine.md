# Data Analyst with Kalio LLM Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Gemini in `data-analitic` with a versioned Kalio structured-output API and move deterministic analysis execution to an embedded DuckDB backend.

**Architecture:** Kalio owns LLM provider/model configuration and exposes one validated structured-generation endpoint. Data Analyst keeps its existing browser-facing plan/explain contract, adapts those calls to Kalio, and adds a server-side `/api/execute` route that compiles typed plans into parameterized DuckDB queries. The browser remains free of LLM credentials and raw rows are not sent to Kalio.

**Tech Stack:** TypeScript 5, NestJS 11, Express, React 19, Vitest, `@duckdb/node-api`, existing Kalio LLM provider abstraction.

## Global constraints

- Follow RED-GREEN-REFACTOR for each production behavior.
- Do not change protected `@kalio/types` contracts; keep the integration DTO local to the Kalio LLM module.
- Do not execute SQL supplied by the model.
- Validate every field against the imported columns and semantic layer, quote identifiers, and parameterize values.
- Do not send raw imported rows from Data Analyst to Kalio.
- Preserve the current Data Analyst `/api/plan` and `/api/explain` frontend contract.
- Use embedded in-memory DuckDB, not Docker, for this slice.
- Keep provider credentials and model selection solely in Kalio.

---

### Task 1: Add a versioned structured-output endpoint to Kalio

**Files:**
- Create: `apps/kalio-api/src/modules/llm/structured-llm.controller.ts`
- Create: `apps/kalio-api/src/modules/llm/structured-llm.controller.spec.ts`
- Modify: `apps/kalio-api/src/modules/llm/llm.module.ts`

- [ ] **Step 1: Write failing controller tests**

Cover a valid structured request, provider metadata, invalid roles/schema,
missing structured callback output, token bounds, and provider failure mapping.

Run:

```powershell
pnpm --filter @kalio/api test -- structured-llm.controller.spec.ts
```

Expected: RED because the controller does not exist.

- [ ] **Step 2: Implement the smallest controller and request validator**

Use the existing `LLMService.streamChat` structured-output option with an empty
tool list. Capture `onStructuredOutput`, retrieve non-secret metadata through
`LLMService.getConfig`, and reject missing output.

- [ ] **Step 3: Register and verify the endpoint**

Add the controller to `LLMModule`, rerun the focused tests, then run:

```powershell
pnpm --filter @kalio/api typecheck
pnpm --filter @kalio/api build
```

Expected: focused tests, typecheck, and build pass.

---

### Task 2: Replace Gemini with a Kalio adapter in Data Analyst

**Files:**
- Create: `E:\Projekty\data-analitic\server\kalio-client.ts`
- Create: `E:\Projekty\data-analitic\server\kalio-client.test.ts`
- Modify: `E:\Projekty\data-analitic\server.ts`
- Modify: `E:\Projekty\data-analitic\package.json`
- Modify: `E:\Projekty\data-analitic\package-lock.json`

- [ ] **Step 1: Add Vitest and write failing adapter tests**

Test the request URL, strict schema payload, timeout/connection mapping,
non-success Kalio responses, and malformed success bodies.

- [ ] **Step 2: Implement the Kalio client**

Use `KALIO_API_URL`, a required bearer token, an `AbortController` timeout, and
runtime response validation. Do not expose provider credentials in Data
Analyst.

- [ ] **Step 3: Replace both Gemini calls**

Keep `/api/plan` and `/api/explain`, but make their prompts and response schemas
go through the Kalio client. Remove `@google/genai` and the `GEMINI_API_KEY`
runtime requirement.

- [ ] **Step 4: Run focused tests**

```powershell
npm test -- server/kalio-client.test.ts
```

Expected: adapter tests pass.

---

### Task 3: Add safe embedded DuckDB execution

**Files:**
- Create: `E:\Projekty\data-analitic\server\duckdb-executor.ts`
- Create: `E:\Projekty\data-analitic\server\duckdb-executor.test.ts`
- Modify: `E:\Projekty\data-analitic\server.ts`
- Modify: `E:\Projekty\data-analitic\package.json`
- Modify: `E:\Projekty\data-analitic\package-lock.json`

- [ ] **Step 1: Add `@duckdb/node-api` and write failing fixture tests**

Use a small sales fixture. Prove grouped sums, averages, filters, ordering,
limits, and validation failures for unknown fields/operators.

- [ ] **Step 2: Implement typed-plan validation and SQL compilation**

Create an isolated `:memory:` database per execution, create/load a temporary
table, compile only supported plan operations, bind values, and close resources
in `finally`.

- [ ] **Step 3: Add `/api/execute`**

Validate request shape and bounded row count, call the executor, return the
existing `QueryResult` contract, and map validation failures to `422`.

- [ ] **Step 4: Run focused tests**

```powershell
npm test -- server/duckdb-executor.test.ts
```

Expected: deterministic fixture tests pass.

---

### Task 4: Route the Data Analyst frontend through the backend executor

**Files:**
- Modify: `E:\Projekty\data-analitic\src\features\analyst\AnalystConsole.tsx`
- Modify only if orphaned: `E:\Projekty\data-analitic\src\utils\dataEngine.ts`

- [ ] **Step 1: Add a failing request-flow test where practical**

Prove that an analyst question calls `/api/plan`, then `/api/execute`, then
`/api/explain`, and that execution errors are displayed without proceeding to
the explanation step.

- [ ] **Step 2: Replace browser execution with `/api/execute`**

Send `rawData`, the typed plan, and semantic layer to the backend. Preserve the
existing UI state and result rendering. Remove only imports or code made
orphaned by this change.

- [ ] **Step 3: Run Data Analyst gates**

```powershell
npm test
npm run lint
npm run build
```

Expected: tests, TypeScript, and production build pass.

---

### Task 5: Cross-application smoke proof and review

**Files:**
- Create: `docs/sessions/2026-07-29-data-analyst-kalio-llm-engine.md`
- Verify: all files changed in Tasks 1–4

- [ ] **Step 1: Run the Kalio local gate with system Node**

```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
pnpm --filter @kalio/api test -- structured-llm.controller.spec.ts
pnpm --filter @kalio/api typecheck
pnpm --filter @kalio/api build
```

- [ ] **Step 2: Run an isolated mock-provider integration**

Start Kalio with the mock provider and Data Analyst pointed at its random or
explicit API port. Submit one plan/execution/explanation request using the
sales fixture. Verify the structured endpoint, exact DuckDB totals, and
user-readable result.

- [ ] **Step 3: Review security, architecture, frontend behavior, and coverage**

Check that raw rows never reach Kalio, model SQL is never executed, request
limits exist, resources close, the frontend has no provider configuration, and
the changed paths have meaningful regression tests.

- [ ] **Step 4: Record evidence**

Write the session note with changed boundaries, exact commands and outcomes,
mock live-readiness status, any unverified paid-provider behavior, and remaining
production blockers.

- [ ] **Step 5: Inspect final scope**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and no unrelated user changes modified by this
implementation.
