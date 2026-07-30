# Data Analyst Native MCP — 2026-07-30

## Outcome

Data Analyst now exposes a native, composable analysis workflow to Kalio,
Codex, and other MCP clients. The agent can create a document-scoped session,
profile data, run bounded read-only SQL, search text, inspect relationships,
read and replay immutable artifacts, and compose a final report rendered by
the DA UI.

The previous `data_analyst_run_analysis` tool remains available as a
compatibility facade. It is not the native agent workflow.

## Architecture boundary

- DA owns raw datasets, DuckDB, safety limits, dataset fingerprints,
  append-only session manifests, immutable artifacts, replay, and report
  snapshots.
- The agent owns investigative choices, interpretation, and the final
  narrative.
- Kalio owns model/provider credentials and exposes DA tools to its agent
  runtime through the repo-managed `.kalio/config.toml`.
- Report-visible lineage redacts SQL literals. The session manifest retains the
  exact query for local audit and replay.

## Implemented evidence

| Area | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| DA native MCP | Passed | 61 tests; lint and production build passed | Persistent upload/catalog |
| DA protocol | Passed | Real SDK initialize, list, native calls, replay, and report creation | Per-client scopes |
| Session lineage | Passed | Session stored exact dataset fingerprint, SQL, replay link, and report event | Durable database store |
| Profiling | Passed | Nulls, duplicates, ranges, quartiles, IQR outliers, encoding markers, and likely variants | BM25 index |
| Report UI | Passed | Desktop and 390 px mobile checks; one h1, chart values, accessible table, lineage | Public authenticated sharing |
| Kalio MCP names | Passed | Provider-safe deterministic names and legacy aliases; 36 focused tests | None for the proven name/dispatch scope |
| Kalio backend | Passed | Built API connected to DA and discovered 10 tools; real `MCPService` call resolved `sales_demo` | Live provider tool-choice canary |

## Direct native analysis canary

- Session: `ed1fab74-21c3-4f65-9ffe-efb2b4c0515a`
- Profile artifact: `f9597a88-7b24-48e8-9dde-2c2a549d8dae`
- Aggregate artifact: `fa916ed8-7d04-4023-aa55-ee0dca9a10c0`
- Replay artifact: `037d8e87-1c30-4965-9ac9-ef905f403afd`
- Report execution: `b08b1803-e85b-4baf-ab78-118a758622fd`
- Verified revenue totals: Północ `5550`, Południe `3750`, Zachód `2950`;
  four orders per region.

## Security and production gaps

- `DA_MCP_RAW_ACCESS` defaults to disabled.
- MCP and report tokens are never committed.
- The current query resource limits do not provide a hard kill deadline.
- Report capability links are local and stored in memory.
- Kalio currently parses MCP allowlist/approval fields without enforcing them
  in the runtime; the committed config therefore does not claim those controls.
- Persistent multi-dataset upload and catalog ownership are the next required
  product slice.

## Final runtime verification

- Kalio focused regression: 95/95 tests passed.
- Kalio full backend test suite, typecheck, and production build passed.
- Built Kalio API connected to `toml::data-analyst` and discovered all 10 tools.
- A real `MCPService` call resolved the provider-safe tool name to
  `data_analyst_list_datasets` and returned `sales_demo`.
- A full `MCPService` canary created a session, profile artifact, aggregate
  artifact, and report through the running production DA backend.
- Final session: `1549891a-e82d-481c-94cb-587b16a65de3`.
- Final profile artifact: `ced2638a-0c9e-4f47-9830-b3b1a7dad99b`.
- Final aggregate artifact: `0f8baa4b-bf24-4aef-b167-fb5498ff4439`.
- Final report URL:
  `http://127.0.0.1:3000/reports/1nnyo0LWvkuGdVeiY9QOWzf5KJdOygNR`
  (local one-hour capability link).
- In-app browser proof: one `h1`, logical report headings, exact chart/table
  values `5550`, `3750`, and `2950`, artifact/query lineage, and no horizontal
  overflow at a 390 px viewport.

The real MCP smoke caught and fixed one transport-contract defect before
handoff: the relationship tool originally published an empty input schema
because the SDK requires a top-level object schema. A RED protocol test now
asserts the required fields and all relationship properties.

Codex performed a direct native-tool analysis and Kalio's real `MCPService`
performed the production-backend canary. A fresh paid-provider run in which a
Kalio-hosted model autonomously chooses the DA tools was not repeated after
this change; it remains a separate cost-bounded canary rather than evidence
implied by the deterministic transport proof.
