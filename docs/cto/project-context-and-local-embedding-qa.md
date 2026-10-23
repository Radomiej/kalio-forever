# CTO notes — Project Context / local embeddings

Recorded: 2026-10-08. Source: user instructions in this chat; paraphrase, not a
verbatim transcript. Exact utterance timestamps were not supplied.

- Download Ollama and EmbeddingGemma2 270M plus the larger variant; measure real
  sizes and retrieval performance rather than repeating published benchmarks.
- Extend manual persona memory with explicit project context: scan registered
  projects, remember code/files/assets and provide fast search context to agents.
- Put the indexing opt-in in Embeddings settings. Users or agents may explicitly
  refresh context; no silent automatic scan is required for the first slice.
- Test on Home Site and verify actual Devin through Kalio, not only mocks.

Implemented decision: separate project/model/revision/resource-type index spaces;
VFS-scoped scan, persisted default-off settings, manual refresh/search UI and
confirmed session-derived tools. Binary assets are metadata-only at this stage.
Do not equate asset presence with visual/audio semantic understanding.

QA508: Devin communication and F5/grouped-graph projection worked. Gemma2 inference
failed in MLX/CUDA13 on GTX1060, including BF16; no quality scores are available.
The failed model was not activated in persistent QA. A CPU-compatible backend or
supported GPU must be selected before real project-index/search benchmarking.
This is a remaining delivery blocker, not an accepted quality degradation.

Evidence: [QA508](../raports/qa-run-508/README.md),
[as-built specification](../spec/embedding-spaces-and-project-resources.md).

## User correction — 2026-10-09

Source: current chat, paraphrased; exact utterance time not supplied.

- Select and install embedding models in one tab, with the selected model visible
  at the top rather than buried below configuration.
- Do not ask users to enter technical model revisions or provider scopes. Derive
  identity from the selected model and explain when its index needs refreshing.
- Preserve old indexes and QA provider settings when updating the UI.
- Say what is actually available: selected/configured does not mean installed,
  and model metadata does not guarantee safely pinned inference.

Implementation exposes model/readiness and removes manual identity fields.
Automatic metadata identity currently covers loopback Ollama only. Project
indexing is still blocked without immutable inference binding; ordinary memory
is not disabled by this change. This is incomplete project-search delivery,
not a successful Gemma benchmark. QA509 records the UI/runtime verification.

## User request — 2026-10-09, Home Site context

Source: current chat, paraphrase; exact utterance time not supplied. “HomeSeat”
was treated as Home Site only after rechecking its registered path
`E:/Projekty/home-site`.

- Index eligible project code and make retrieved context useful to agents.
- Keep short files whole when they fit; split larger code by declarations or
  methods where supported, preserving file/line information.
- Refresh changed project context automatically and provide a tested QA build.

Decision: on-demand refresh before search, not a perpetual filesystem watcher.
The existing opt-in and per-operation cloud consent remain enforced. Add/change/
delete and chunking-version changes invalidate reuse. Real-tokenizer limits are
required: the first Home Site check found 41/61 old chunks above E5's 512-token
context; storing complete FTS text was not sufficient vector-retrieval proof.
QA510 records the rebuilt-index verification and remaining Devin tool boundary.
