# Project Context: Home Site hybrid retrieval and auto-refresh QA

## Final authorized hybrid/API follow-up — supersedes initial blockers for Home Site

At the parent's post-build/restart notification, the user explicitly authorized
normal Home Site auto-refresh and eight sequential hybrid queries. No Kalio
registration/indexing, settings change or product edit was authorized/performed.
All initial read-only observations below are retained as before-refresh evidence.

Executed through `http://localhost:5288`: POST `/api/decision/auth`, Origin
`http://localhost:5288`, JSON `{}` returned 204. Set-Cookie was retained only in
process memory and sent on the same-origin GET/PUT requests. No bearer token
was needed, logged or persisted. This is the normal bootstrap used by
`apps/e2e/tests/helpers/hitl-fixture-auth.ts`; no fixture endpoint was used.

Protected settings GET returned 200 and `enabled:true`, resolved model revision
`761b726dd34fb83930e26aab4e9ac3899aa1fa78`. Protected resource status GET
returned 200 with E5-small, CPU, 384 dimensions and the original 110-chunk index.
Each query used PUT `/api/memory/project-resources/YcHlHteb994I7cWAkTqF3/search`
with the exact H1-H8 question text below, `mode:hybrid`,
`resourceTypes:[code,text]`, `limit:5`. The first request had a 120-second client
deadline; later requests had 30 seconds. All completed; no timeout/retry.

| Query | HTTP | End-to-end ms | Expected evidence rank | Returned evidence label |
|---|---|---|---|---|
| H1 / declared libraries | 200 | 6857 | 1 | `package.json:1-20` |
| H2 / validation definition | 200 | 160 | 3 | `src/App.jsx:224-248` |
| H3 / validation callsite | 200 | 130 | 1 | `src/App.jsx:247-279` |
| H4 / React entry point | 200 | 97 | 1 | `src/main.jsx:1-10` |
| H5 / App composition | 200 | 84 | 3 | `src/App.jsx:393-409` |
| H6 / validation conditions | 200 | 117 | 1 | `src/App.jsx:224-248` |
| H7 / package scripts | 200 | 101 | 1 | `package.json:1-20` |
| H8 / HTML module entry | 200 | 91 | 2 | `index.html:1-14` |

Actual hybrid expected-chunk recall@5: 8/8; expected evidence at rank 1: 5/8.
First-call latency includes normal refresh and query work; model-loading time
was not separately instrumented, so 6857 ms must not be labelled model-load
time alone. Subsequent end-to-end latency: 84-160 ms. There was no competing
test workload dispatched by this worker; parent held its unit gate during calls.
Successful hybrid inference now proves query-time model usability for this run.
No standalone download/install operation was requested; cache/file writes inside
the provider were not independently traced.

Final API status returned 108 chunks and indexedAt `1792271994975`.
Independent read-only SQLite/source-hash verification at
`2026-10-17T21:20:06.517Z` confirmed generation 3 (previously 2),
`token-bounded-v2`, indexed `2026-10-17T21:19:54.975Z`, 8 indexed source files,
and zero hash mismatches. Indexed title is now
`Nekko Software — Nowoczesne rozwiązania IT`. App.jsx definition/callsite and
composition result labels now contain their current source lines.

Final verdict: PASS for the bounded Home Site hybrid API/normal auto-refresh
scenario. The earlier stale snapshot did not establish an auto-refresh defect;
this follow-up demonstrates that the normal refresh repaired it. H2 still
ranks two near-duplicate handoff documents above the exact definition, a P3
ranking observation. No claim of general semantic accuracy, generated-answer
quality, UI navigation proof or production readiness follows from eight queries.
Kalio retrieval remains BLOCKED because no Kalio index exists in the tested QA
store and creating one was explicitly excluded. Chat-title testing remains owned
by the parent. CPU inference is finished; no background query was left running.

| Final AC | Status | Evidence | Remaining |
|---|---|---|---|
| Enabled/resolved model and inference | PASS | cookie GET 200, E5-small CPU/384; hybrid 8x200 | Cold-start loading not separately timed |
| Home Site hybrid retrieval | PASS | 8/8 expected chunks top 5 | Broader corpus/answer quality not claimed |
| Normal freshness/title repair | PASS | generation 2 to 3; 8/8 hashes match; Nekko title | No manual index call used |
| Kalio retrieval | BLOCKED | no registration/index in tested QA store | Outside authorized indexing scope |

## Initial read-only phase (historical evidence)

Observed: 2026-10-17, final metadata check 21:11 UTC. Checkout:
`C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever`, branch
`codex/kalio-provider-runtime-ux`, starting HEAD `8cbe6e6c`.

### Historical verdict before authorized refresh (superseded for Home Site)

CONDITIONAL for retrieval from the stored Home Site snapshot; UNVERIFIED for
current end-to-end Project Context. No product changes, indexing, downloads,
settings writes, build, QA restart, or provider inference were performed.
README changes from the previous task were preserved. Chat titles are tested
by the parent; this report evaluates resource paths, chunk labels and indexed
document titles only. The parent's independent Devin fs_read canary is not
retrieval evidence for this report.

## Actual environment and index state

- Managed stack state identifies API `http://127.0.0.1:3316`, UI port 5288,
  database `%LOCALAPPDATA%/kalio-forever-qa/kalio-qa.db`, and memory root
  `%LOCALAPPDATA%/kalio-forever-qa/memory`.
- Read-only SQLite inspection: `project_context_settings = {"enabled":true}`.
- GET `/api/memory/status/embedding`: `configured:true`,
  `provider:local-transformers`, `model:Xenova/multilingual-e5-small`,
  `dimensions:384`, `backend:cpu`.
- GET `/api/memory/embedding-local`: `enabled:true`, same model/dimensions/CPU.
  These status reads do not establish successful model inference or readiness
  after a cold start; no inference was requested.
- One project-resource database exists in this managed QA memory root:
  Home Site, project ID `YcHlHteb994I7cWAkTqF3`, registered path
  `E:/Projekty/home-site`. It contains 110 chunks from 8 distinct files.
- Manifest: indexed `2026-10-09T15:48:05.078Z`, generation 2,
  chunking version `token-bounded-v2`, model revision
  `761b726dd34fb83930e26aab4e9ac3899aa1fa78`, CPU, 384 dimensions.
- SHA-256 of all 8 indexed source paths was compared with current files.
  Six match; `src/App.jsx` and `index.html` differ. This is a stale snapshot,
  not evidence that the normal service fails to refresh it.
- Kalio is not a registered project in this QA database. There is no Kalio
  project-resource index in this memory root. No other runtime/data root is
  claimed to have been inventoried.

## Method and boundaries

Existing benchmarks were inspected: `scripts/bench-project-context-answers.mjs`
and the resource store/controller/service. The benchmark is tied to an older
run and evaluates inference across shards, so it was not executed.

Queries below actually executed against the existing `resources_fts` table
using system Node `C:/Program Files/nodejs/node.exe` outside the sandbox and
`better-sqlite3` with `{readonly:true,fileMustExist:true}`. The SQL reproduced
the store's FTS branch: Unicode word tokens joined by OR, code/text types,
`bm25` ordering with ID tie-break, fetch 20 and report top 5. This is a direct
read-only FTS backend test, not an HTTP or semantic/hybrid test. No agent
generated answers. Current source reads supplied the independent answer oracle.

Latency measures SQL retrieval and result slicing only, excluding database
open, source verification, HTTP, embedding inference and response generation.
One sequential sample per query; H1 is first and later queries can use warm
SQLite/OS caches. No correction/retry of queries was performed.

The public search service calls `ensureFreshIndex` before querying; stale data
can trigger document embedding and index replacement. Calling it would violate
the no-reindex scope. The store constructor also runs schema DDL, so the
read-write store wrapper was not instantiated. GET of guarded Project Context
settings with the existing DPAPI-protected control-plane token returned 401;
no alternate authentication or fabricated browser headers were attempted.
The two unguarded embedding status/config GETs succeeded outside the sandbox.

## Executed questions and evidence

Rank means the first top-5 result containing both the expected path and anchor.
Line ranges are the index's literal labels, not corrected current-source lines.

| ID | Question actually submitted | Expected match | Retrieved evidence / rank | SQL ms |
|---|---|---|---|---|
| H1 | Which React and Vite libraries are declared in package.json? | `package.json`, `react` | `package.json:1-20`, rank 3 | 7.497 |
| H2 | Where is contact form validation waliduj defined and what fields does it check? | `src/App.jsx`, `const waliduj` | `src/App.jsx:274-300`, rank 3 | 0.615 |
| H3 | Where does onSubmit call waliduj form and focus pierwszyBlad? | `src/App.jsx`, `const errs = waliduj(form)` | `src/App.jsx:297-328`, rank 1 | 0.540 |
| H4 | Where does createRoot render App inside React StrictMode? | `src/main.jsx`, `createRoot` | `src/main.jsx:1-10`, rank 1 | 0.399 |
| H5 | Where is Kontakt rendered in the App page architecture? | `src/App.jsx`, `<Kontakt` | `src/App.jsx:458-475`, rank 4 | 0.580 |
| H6 | What contact form email regex validates email and min length wiadomosc? | `src/App.jsx`, `wiadomosc.length < 10` | `src/App.jsx:274-300`, rank 1 | 0.569 |
| H7 | What build preview and dev scripts are declared in package.json? | `package.json`, `vite build` | `package.json:1-20`, rank 1 | 0.506 |
| H8 | Which index.html module script loads src/main.jsx? | `index.html`, `/src/main.jsx` | `index.html:1-13`, rank 1 | 0.344 |

Expected chunk recall@5: 8/8; evidence at rank 1: 5/8. These are retrieval
checks, not an answer-generation score. Broad English questions H1/H2/H5 rank
two near-duplicate six-line QA handoffs before the relevant source; H1 also
returns package-lock chunks. This is observable ranking noise in FTS-only mode.

Ground truth from current approved source:

- `package.json:13-18`: React/react-dom `^18.3.1`, Vite `^5.4.11`,
  plugin-react `^4.3.4`; scripts at lines 8-10 are vite/vite build/vite preview.
- `src/App.jsx:241-250`: `waliduj` trims imie/email/wiadomosc, requires name
  length >=2, an email regex match and message length >=10.
- `src/App.jsx:252-264`: `onSubmit` calls `waliduj` at 255 and focuses the
  first invalid field. `Kontakt` is rendered at current line 404.
- `src/main.jsx:6-10`: React root renders App inside StrictMode.
- `index.html:12`: module script points to `/src/main.jsx`.

## Resource labels and titles

All inspected returned chunks carry a usable relative resource path and a
`File: "..."; lines a-b` label. No separate human title/symbol label is exposed
by the store's search result; its explicit fields are path, type,
representation, content, score, creation time and model/hash metadata.
The path plus content label can identify a source, but stale App.jsx line
ranges cannot be used as current navigation targets: validation is now 241,
not the indexed 274-300 range; the App composition is now 404, not 458-475.

Indexed `index.html` title: `NEXORA — Nowoczesne rozwiązania IT`.
Current title: `Nekko Software — Nowoczesne rozwiązania IT`.
This is a proven stale document title. It is unrelated to chat-title behavior.

### Historical closure matrix (before refresh; not the final conclusion)

| AC / area | Status | Evidence | Remaining |
|---|---|---|---|
| AC-01 / enabled and selected model | PASS | persisted opt-in plus two live embedding GETs | Inference readiness unverified |
| AC-02 / Home Site existing-index retrieval | PASS, snapshot only | 8 executed FTS questions, 8/8 expected chunks in top 5 | Full API/hybrid not exercised |
| AC-03 / current navigation and titles / PIT-11 | FAIL for stored snapshot | 2/8 hashes differ; title and App.jsx line drift | Normal auto-refresh behavior unverified |
| AC-04 / Kalio retrieval | BLOCKED | no project registration or index in active QA store | Requires coordinated registration/indexing outside this scope |
| AC-05 / resource labels | PASS structurally | file/line labels in actual FTS hits | Freshness caveat above; no GitHub/UI rendering claim |
| AC-06 / no-write boundary | PASS | SQLite read-only; only two embedding GETs and denied settings GET | No product changes or inference |

[Resolved] The initially missing freshness/API test was subsequently authorized
and completed: all eight hybrid calls returned 200 and normal auto-refresh
updated the source hashes, line labels and document title. The historical
snapshot failure above is superseded for Home Site.

[P2] Required for the requested Kalio comparison: use an explicitly registered
Kalio project with an existing suitable index, or separately authorize its
indexing and inference cost. No benchmark against a missing index is claimed.

[P3] Hybrid comparison completed. Duplicate handoff hits still precede the
exact validation definition for H2; this is a ranking-quality observation.

## Final conclusion — approved hybrid/API run

PASS for the bounded Home Site test, verified at `2026-10-17T21:20:06.517Z`:
standard same-origin cookie bootstrap 204; protected reads and all eight
hybrid searches 200; expected evidence top 5 in 8/8 queries and top 1 in 5/8.
Actual selected and successfully used model: `Xenova/multilingual-e5-small`,
CPU, 384 dimensions, revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`.

| Query | HTTP | Actual end-to-end latency ms | Expected evidence rank |
|---|---|---|---|
| H1 | 200 | 6857, including normal auto-refresh | 1 |
| H2 | 200 | 160 | 3 |
| H3 | 200 | 130 | 1 |
| H4 | 200 | 97 | 1 |
| H5 | 200 | 84 | 3 |
| H6 | 200 | 117 | 1 |
| H7 | 200 | 101 | 1 |
| H8 | 200 | 91 | 2 |

Normal auto-refresh is proven: generation 2 -> 3, 110 -> 108 chunks,
indexedAt `2026-10-17T21:19:54.975Z`, all 8 source hashes match. Indexed title
is now `Nekko Software — Nowoczesne rozwiązania IT`; App.jsx results contain
current validation/callsite/composition lines. Earlier snapshot-only freshness
FAIL and hybrid UNVERIFIED labels are historical, not outstanding Home Site
failures. Cold model loading was not separately timed from the first request.

Kalio remains BLOCKED: no Kalio registration/index in the tested QA store;
full indexing was explicitly excluded. Chat-title proof belongs to the parent.
No product/configuration changes, manual index endpoint, or further runtime
inference were performed. No inference remains running; final gates may proceed.
This result is local QA evidence, not production or broad-corpus certification.
