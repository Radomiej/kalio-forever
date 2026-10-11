# Embedding spaces and project resources — 2026-10-08

## As-built boundary

An embedding space binds provider, non-secret provider scope, endpoint fingerprint,
model, revision, dimensions, backend and document/query/normalization versions.
SHA256 IDs replace lossy sanitized model names. Users select a model, not a digest
or provider scope. Loopback Ollama metadata resolves the exact selected tag's
digest and derives a non-secret scope from endpoint and configured source.
Reads are bounded, reject redirects and share concurrent identity checks.
Persisted manual identity fields are accepted only as a legacy input format;
they never establish the current model's identity.

Integrity checking a descriptor does not establish producer trust. Local
Transformers models other than the catalog-pinned E5-small CPU adapter, and
remote providers, remain unresolved. Project indexing/search rejects unresolved identity with
`EMBEDDING_REVISION_REQUIRED` (409). Ollama metadata alone also cannot prove which
weights `/api/embed` used: a mutable tag could change A→B→A during inference.
Project indexing/search therefore rejects Ollama with
`EMBEDDING_IMMUTABLE_INFERENCE_REQUIRED` (409), even with a valid metadata digest.
Ordinary memory retains its existing provider behavior; this is not a claim that
its legacy unresolved spaces have immutable producer guarantees.

Persona databases are partitioned into `memory` and `conversation` within a space;
web results remain separate. Current-space search combines ranks, not incomparable
raw distances. Legacy databases are read-only reindex sources, never initialized
with the new model's vector dimensions. Existing memory becomes available in the
new partitions after explicit reembed; source databases are retained. No automatic
QA migration or provider change was performed.

Project resources use one SQLite database per project/space, separate sqlite-vec
tables per resource type and an FTS index. Type filtering happens before top-k.
Text and supported source code embed content. Image/audio/video/PDF entries embed
file path, type and size **only** and return `representation: metadata`. This is
not OCR, transcription or native multimodal semantic retrieval.

## API

All routes require the local control-plane bearer capability or issued HttpOnly
browser cookie with exact original Host/Origin. These are local single-user
capabilities, not multi-tenant project ACLs.

| Method | Route | Body/result |
| --- | --- | --- |
| GET | `/api/memory/project-context/settings` | `{enabled, modelRevision, providerScope}`; identity derived by backend |
| PUT | `/api/memory/project-context/settings` | `{enabled}`; default off; legacy three-field input validated but identity ignored |
| GET | `/api/memory/project-resources/:projectId/status` | Active space and chunk count |
| PUT | `/api/memory/project-resources/:projectId/index` | `{allowRemoteProcessing?: boolean}`; bounded full replacement |
| PUT | `/api/memory/project-resources/:projectId/search` | `{query, resourceTypes?, limit?, mode?, allowRemoteProcessing?}` |

Search intentionally uses JSON body, not URL query parameters, to avoid copying
search text into URL history and typical access logs. After persisted opt-in,
search creates or refreshes its index on demand. There is no startup/background scan.
Remote embedding calls require explicit consent on each operation. Local Ollama
loopback and local Transformers do not require cloud consent. FTS makes no
query-embedding request, but can perform authorized document embedding when its
index needs refreshing. Settings > Embeddings shows the selected model prominently,
with installation/readiness separate from configuration. The same tab contains
existing model selection/install controls and Project Context: opt-in,
registered-project selection, manual refresh and search. There are no user-facing
revision/scope fields. Changing the selected model invalidates old UI state and
checks its separate index; previous indexes are retained. Failed loading blocks
operations and offers retry. Unsupported project-index models are shown as
unavailable, rather than offering an operation known to fail.
Remote consent is consumed per operation, never persisted globally.
The tools `refresh_project_context` and `search_project_context` resolve their
project from the persisted calling session through `PROJECT_CONTEXT_PORT`; the
agent cannot supply an arbitrary project ID. Both require confirmation. These
tools are not automatically added to an existing persona's allowlist.
There is no startup crawler, background refresh scheduler or automatic insertion
of search results into every agent prompt. Explicit tools provide retrieved context.

VFS resolves only registered project IDs, rejects escaping paths and links,
excludes dependency/generated/credential/private paths and bounds enumeration to
500 files, 1 MiB/file, 20 MiB total, depth 16 and 5000 entries. Exclusions are
heuristics, not a secret scanner; even ordinary source code may contain secrets.
Indexing is explicit, not startup/background crawling.
The resource store caps accumulated databases at 16 across projects/spaces and
each SQLite database at 64 MiB through `max_page_count`. Journal/WAL transient
overhead is not a promised hard total-disk quota. Reaching a cap rejects work and
does not automatically delete prior indexes.

Publication embeds all batches before a single SQLite transaction. A second VFS
read must match source hashes before publication. Search revalidates indexed file
hashes before and after retrieval. Added/changed/deleted/excluded supported sources
trigger automatic refresh; unchanged sources do not reembed documents. At most
one additional refresh/retrieval attempt is allowed when sources change during
search. Continued mutation fails closed with `PROJECT_RESOURCE_REINDEX_REQUIRED`
(409), never partial stale results. Failed rebuild leaves the old snapshot intact.
Filesystem verification is not an atomic OS snapshot; changes after the last
verification remain an inherent boundary. Search makes bounded freshness reads;
large-project throughput is not yet benchmarked.
Search also binds the exact monotonic publication generation: concurrent reindex
returns `PROJECT_RESOURCE_INDEX_CHANGED` (409), even if file hashes stay equal.

## Code chunking and local E5 — 2026-10-09

Short files remain whole when they fit. Larger TS/JS variants prefer declarations
and class members; other languages use line windows with bounded overlap. Results
carry file/line labels and retain source coverage, including CRLF and Unicode.
The actual loaded tokenizer measures the complete inference input, including
transform prefixes, labels, optional context and special tokens. E5's 512-token
budget causes further source splitting; an impossible mandatory header fails
before publication. Query inputs above that limit are rejected rather than cut.
Binary metadata must also fit; this does not add multimodal understanding.

The manifest stores `token-bounded-v2` atomically with rows/vectors/generation.
Old/missing chunking markers trigger rebuild even with unchanged file hashes.
Repeated current searches do not repeat document inference.

Only `Xenova/multilingual-e5-small`, explicit CPU/q8 and catalog commit
`761b726dd34fb83930e26aab4e9ac3899aa1fa78` currently have a trusted local project
binding. Explicit tokenizer/model construction avoids unpinned discovery in
Transformers 4.2. A pnpm patch drains both tokenizer file loads before rejection;
the provider owns/restores global load settings and drains inference on disposal.
The cache is application-owned trusted storage, not an anti-tampering guarantee.
This does not close Gemma2's previous GPU inference failure or establish arbitrary
model safety. Ordinary legacy memory behavior is not silently migrated.

## EmbeddingGemma 2 assessment

Google's published comparison gives CodeMTEB 78.68 versus 68.76 for its predecessor
and multilingual text 61.36 versus 61.15. This supports a code-retrieval experiment,
not an automatic replacement of existing memory embeddings. The model supports
768 native dimensions and Matryoshka 128/256/512/768, 8192 context and 100+ languages.
Sources: [model card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2),
[overview](https://ai.google.dev/gemma/docs/embeddinggemma),
[official task prefixes](https://ai.google.dev/gemma/docs/embeddinggemma/inference-embeddinggemma-with-sentence-transformers).

Pinned Gemma2 document/query/code-query requests use separate official prefixes.
Ollama requests send desired dimensions and `truncate:false`; incompatible output
counts/dimensions/nonfinite vectors are rejected. No client-side arbitrary vector
truncation was added. TransformersJS compatibility and native Ollama audio/video
are not inferred from the model card. Gemini Embedding 2 is a different model/API
and is not added by this change.

## Local quality measurement

`scripts/bench-embedding-retrieval.mjs` accepts a curated JSON dataset:

```json
{"documents":[{"id":"build","text":"Source or document content"}],"queries":[{"text":"Jak zbudować projekt?","relevantIds":["build"]}]}
```

Run with an already installed local model:

```powershell
node scripts/bench-embedding-retrieval.mjs dataset.json embeddinggemma-2:270m
```

It reports Recall@5, MRR, dimensions and batch latency, uses loopback Ollama only,
does not install/download models, and does not persist embeddings. Query count is
bounded to 100 and corpus to 500 documents. Use the same reviewed 50–100-query
Polish/code dataset for each candidate; do not call the tiny synthetic metric test
a quality benchmark. Qwen-specific task instructions require a reviewed adapter
before a fair Qwen comparison. GPU/RAM use and cold/warm timing remain separate
measurements.

## Release gates

Local fixture/HTTP/SQLite tests and builds do not prove actual model quality,
multimodal search, browser workflow, QA deployment or production readiness.
Before rollout: backup memory, inspect explicit reembed results, preserve provider
settings, run a real local-model retrieval benchmark and review legacy migration.

## QA508 actual runtime boundary

Portable Ollama 0.40.1 and Gemma2 270M, 270M BF16 and 740M were downloaded.
All three inference smoke tests failed in the MLX CUDA13 runtime on the local
GTX1060. The real HomeSite benchmark exited `OLLAMA_HTTP_500`; no quality or
throughput score is available. See `docs/raports/qa-run-508/README.md` for exact
sizes, identity, tests and real Devin/F5 evidence. Do not activate these failed
models as the QA embedding provider or claim native asset-content retrieval.
