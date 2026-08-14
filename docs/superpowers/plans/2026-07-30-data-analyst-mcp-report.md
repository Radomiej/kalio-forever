# Data Analyst MCP Tool and Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Data Analyst as an authenticated local HTTP MCP server that runs a deterministic DuckDB analysis through Kalio and returns an expiring report page URL.

**Architecture:** One Data Analyst `RunAnalysis` use case owns a backend-only demo dataset registry, plan policy, DuckDB execution, aggregate policy, tool-free Kalio planning/explanation, and immutable one-hour report snapshots. A stateless Streamable HTTP MCP adapter exposes that use case without calling DA's own HTTP routes. Kalio and Codex connect to the same bearer-protected `/mcp` endpoint.

**Tech Stack:** TypeScript 5.8, Express 4, React 19, Recharts 3, `@modelcontextprotocol/sdk` 1.29, Zod 4, embedded DuckDB, Node test runner, Kalio NestJS MCP client.

## 2026-07-30 implementation amendment

The original two-tool aggregate facade was shipped first, then intentionally
extended into the user-approved native agent workflow. The implementation now
adds durable analysis sessions and composable profile, SQL, text-search,
relationship, artifact-read, artifact-replay, and report-authoring tools.
`data_analyst_run_analysis` stays for compatibility; it is not the target
workflow for Codex, Kalio, or Claude.

Completed and verified in Data Analyst:

- authenticated stateless Streamable HTTP MCP;
- embedded DuckDB execution and provider-independent deterministic artifacts;
- exact dataset fingerprints and append-only JSON session manifests;
- encoding/mojibake and likely typo-variant detection;
- agent-authored reports built only from immutable non-raw artifacts;
- replay lineage for exact SQL/search operations;
- responsive report UI with chart, accessible table, and audit metadata;
- 61 tests, lint, production build, real MCP SDK flow, and direct Codex-driven
  native-tool analysis.

Remaining production slices:

- persistent multi-file upload and versioned dataset catalog;
- killable query deadlines in a worker/process boundary;
- authenticated durable report storage instead of in-memory capability links;
- BM25/full-text indexing and tenant-specific masking/scopes.

## Global Constraints

- Follow RED-GREEN-REFACTOR for every production behavior.
- Bind Data Analyst to `127.0.0.1`; report links are local and expire after one hour.
- Never pass raw rows through MCP or Kalio.
- Never execute SQL emitted by a model.
- Keep MCP tool inputs to typed ids and bounded questions.
- Return only safe summary metadata in MCP text and structured content; keep
  aggregate tables on the report page.
- Use an independent 192-bit report capability token; `executionId` is not an
  authorization credential.
- Reject untrusted Origin headers and emit no wildcard CORS.
- Make Kalio planning and explanation tool-free to prevent recursive DA calls.
- Enforce dimension/measure allowlists, an aggregate requirement, grouped-row
  and serialized-byte limits before data leaves the DuckDB boundary.
- Keep every production source file below 500 lines.
- Preserve unrelated user changes and stage only task-owned files.
- Use descriptive commits after independently verified slices.

---

### Task 1: Add backend dataset and report contracts

**Files:**
- Create: `E:\Projekty\data-analitic\server\dataset-registry.ts`
- Create: `E:\Projekty\data-analitic\server\dataset-registry.test.ts`
- Create: `E:\Projekty\data-analitic\server\analysis-report-store.ts`
- Create: `E:\Projekty\data-analitic\server\analysis-report-store.test.ts`

**Interfaces:**
- Produces: `DatasetRegistry.list()`, `DatasetRegistry.get(datasetId)`, and one immutable `sales_demo` dataset.
- Produces: `AnalysisReportStore.save()` and `getByReportToken()` with independent execution id/capability token, `createdAt`, and `expiresAt`.

- [ ] **Step 1: Write failing registry and snapshot tests**

Test deterministic safe dataset metadata, clone isolation, unknown/path-like
ids, capability-token separation, expiry at exactly one hour, and the absence
of raw rows. Include a raw-only canary that must never appear in public
projections.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```powershell
npx tsx --test server/dataset-registry.test.ts server/analysis-report-store.test.ts
```

Expected: failure because the registry and report fields do not exist.

- [ ] **Step 3: Implement the smallest registry and report snapshot store**

Keep the fixture backend-only and return defensive clones. Use a dedicated
bounded report store so the existing short-lived `/api/execute` receipt remains
backward-compatible.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the same command. Expected: all focused tests pass.

- [ ] **Step 5: Commit the domain slice**

Stage only the four files and commit:

```text
feat(da): add server-owned analysis report snapshots
```

### Task 2: Add the authenticated Streamable HTTP MCP endpoint

**Files:**
- Create: `E:\Projekty\data-analitic\server\analysis-service.ts`
- Create: `E:\Projekty\data-analitic\server\mcp-server.ts`
- Create: `E:\Projekty\data-analitic\server\mcp-server.test.ts`
- Modify: `E:\Projekty\data-analitic\server.ts`
- Modify: `E:\Projekty\data-analitic\package.json`
- Modify: `E:\Projekty\data-analitic\package-lock.json`
- Modify: `E:\Projekty\data-analitic\.env.example`

**Interfaces:**
- Consumes: `DatasetRegistry`, `AnalysisExecutionStore`, `KalioClient`, `executeDuckDbQuery`.
- Produces: `mountMcpServer(app, dependencies)` and the two `data_analyst_*` tools.

- [ ] **Step 1: Add SDK dependencies and write failing protocol tests**

Add exact compatible dependencies:

```powershell
npm install @modelcontextprotocol/sdk@1.29.0 zod@4.3.6
```

Use an actual MCP SDK client against an ephemeral HTTP server. Test missing and
invalid bearer tokens, rejected origins, tool discovery, dataset listing,
unknown dataset errors, successful analysis orchestration with a fake Kalio
boundary, and safe text plus structured result content. Assert exactly two
tools and no aggregate table in MCP output.

- [ ] **Step 2: Run focused MCP tests and confirm RED**

Run:

```powershell
npx tsx --test server/mcp-server.test.ts
```

- [ ] **Step 3: Implement analysis orchestration and MCP transport**

Register stateless Streamable HTTP transport at `/mcp`. Validate bearer auth
and trusted Origin before transport dispatch. Construct a fresh MCP server and
transport per request, register two tools, and close transport resources after
the response.

- [ ] **Step 4: Mount the MCP endpoint and configure environment**

Initialize the shared registry/store/analysis service in `server.ts`. Document
`DA_MCP_TOKEN`, `DA_PUBLIC_BASE_URL`, and the one-hour TTL default without
committing a real token.

- [ ] **Step 5: Run focused and full backend tests**

```powershell
npm test
npm run lint
```

Expected: all tests and TypeScript checks pass.

- [ ] **Step 6: Commit the MCP slice**

```text
feat(da): expose the analysis engine over MCP
```

### Task 3: Add the report API and responsive report page

**Files:**
- Create: `E:\Projekty\data-analitic\src\api\reportApi.ts`
- Create: `E:\Projekty\data-analitic\src\api\reportApi.test.ts`
- Create: `E:\Projekty\data-analitic\src\features\reports\AnalysisReportPage.tsx`
- Create: `E:\Projekty\data-analitic\src\features\reports\ReportResultTable.tsx`
- Modify: `E:\Projekty\data-analitic\src\App.tsx`
- Modify: `E:\Projekty\data-analitic\src\features\analyst\ChartRenderer.tsx`
- Modify: `E:\Projekty\data-analitic\server.ts`
- Modify: `E:\Projekty\data-analitic\package.json`

**Interfaces:**
- Produces: `GET /api/reports/:reportToken` with no-store/referrer/CSP headers.
- Produces: `fetchAnalysisReport(reportToken)` and `/reports/:reportToken`.
- Consumes: the immutable aggregate report snapshot.

- [ ] **Step 1: Write failing report API tests**

Test successful safe-projection decoding, `410` expired mapping, malformed
payload rejection, URL-safe capability token validation, and response security
headers.

- [ ] **Step 2: Run report tests and confirm RED**

```powershell
npx tsx --test src/api/reportApi.test.ts
```

- [ ] **Step 3: Implement the API and route selection**

Add the report endpoint before the SPA fallback. Select
`AnalysisReportPage` from `window.location.pathname` without adding a router
dependency.

- [ ] **Step 4: Implement the report reading order**

Render report identity, question, escaped plain-text takeaway, directly
labelled chart, accessible result table, sanitized plan/filter details, audit
metadata, loading/error, and expired states. Reuse the current slate/white
visual system.

- [ ] **Step 5: Run Data Analyst gates**

```powershell
npm test
npm run lint
npm run build
```

- [ ] **Step 6: Verify desktop and mobile in the in-app browser**

Check the working report at 1440×900 and 390×844. Confirm no overflow, visible
values without hover, keyboard-readable links/table, and the expired state.

- [ ] **Step 7: Commit the report slice**

```text
feat(da): add expiring analytical report pages
```

### Task 4: Register Data Analyst MCP in Kalio and Codex

**Files:**
- Create: `.kalio/config.toml`
- Modify: `.env.example`
- Modify: `README.md` only in a task-owned hunk if it can be staged without user changes
- Modify: user-local `C:\Users\Radomiej\.codex\config.toml` through `codex mcp add`

**Interfaces:**
- Consumes: `http://127.0.0.1:3000/mcp` and `DA_MCP_TOKEN`.
- Produces: Kalio tool names prefixed from managed server key `toml::data_analyst`.

- [ ] **Step 1: Add the managed Kalio MCP entry**

Configure the URL, bearer env var, exact two-tool allowlist, non-required
startup, and prompt approval mode. Do not commit a token.

- [ ] **Step 2: Run Kalio config and MCP focused tests**

```powershell
pnpm --filter @kalio/api test -- kalio-config.service.spec.ts mcp.service.spec.ts
pnpm --filter @kalio/api typecheck
pnpm --filter @kalio/api build
```

- [ ] **Step 3: Register the equivalent Codex MCP server**

Use the Codex MCP CLI or a precise user-local config edit with
`bearer_token_env_var = "DA_MCP_TOKEN"`. Verify the effective entry without
printing the token.

- [ ] **Step 4: Commit the Kalio configuration slice**

Stage only `.kalio/config.toml`, the task-owned `.env.example` hunk, and any
task-owned documentation:

```text
feat(mcp): register the Data Analyst tool engine
```

### Task 5: Prove the real cross-application tool flow

**Files:**
- Create: `docs/sessions/2026-07-30-data-analyst-mcp-report.md`
- Modify: `project-spec.md`

**Interfaces:**
- Consumes: built Data Analyst, Kalio MCP client, configured DeepSeek V3.2 provider.
- Produces: recorded runtime evidence and durable architecture boundary.

- [ ] **Step 1: Start isolated local services with system Node**

Start Data Analyst with a disposable `DA_MCP_TOKEN` and Kalio with the matching
MCP bearer environment. Resolve actual ports and health before calls.

- [ ] **Step 2: Run a direct real-protocol MCP smoke**

Use the MCP SDK client to list tools, call `data_analyst_list_datasets`, run one
analysis, fetch the capability report API, and open the returned URL.

- [ ] **Step 3: Run the Kalio MCP smoke**

Verify Kalio connects to `toml::data_analyst`, exposes the prefixed tools, and
dispatches at least one real call through `MCPService`.

- [ ] **Step 4: Run one real cheap-model analysis**

Guard the effective provider/model as OpenRouter DeepSeek V3.2. Ask for sales
by region, verify the aggregate values came from DuckDB, and confirm the report
URL loads. Do not broaden the paid run.

- [ ] **Step 5: Record evidence and durable boundaries**

Document exact commands, outcomes, provider/model evidence, report URL shape,
security boundaries, any unverified production-share behavior, and remaining
blockers. Update `project-spec.md` with DA MCP ownership.

- [ ] **Step 6: Run final verification**

```powershell
git diff --check
git status --short
```

Confirm no unrelated user files are staged, all started processes are stopped,
and the Data Analyst Serena artifact is removed.

- [ ] **Step 7: Commit documentation**

```text
docs: record Data Analyst MCP verification
```
