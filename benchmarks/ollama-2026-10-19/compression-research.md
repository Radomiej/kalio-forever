# Context and token compression: sources checked 2026-10-19

The strongest starting point for Kalio is selective context construction. Enlarging the window, caching computation and compressing text solve different problems. The priority below is an engineering recommendation for small local models, not a universal leaderboard of compression algorithms.

| Priority | Technique | Why it fits Kalio | Important limit |
|---|---|---|---|
|1|Static tool profiles, then discovery/lazy schemas|Remove unrelated schemas before inference; keep3–6 common tools and activate3–5 relevant matches.|Discovery needs a separate authorized catalog and active schema list. An informational tool search alone does not help.|
|2|Bounded tool results and server-side projection|Return relevant lines/fields/pages or aggregates; retain the full artifact with a retrieval reference.|Do not discard execution status, error details, required IDs or outstanding approvals.|
|3|Structured compaction plus durable notes|Preserve task/constraints/decisions/open work and recent evidence; clear old redundant raw outputs.|Summaries can lose facts and force extra retrieval. Keep originals retrievable.|
|4|Query-specific retrieval and reranking|Prefer relevant document chunks to filling the entire window. Begin with lexical/domain routing and measure multilingual recall.|Retrieval and reranking add cost and can miss dependencies; test cross-document questions.|
|5|Stable prefix caching|Keep system text and core schema order stable to reuse prefill across related turns.|This saves computation, not logical tokens or context capacity; never compare a warm request with a cold one as equal conditions.|
|6|Selective LLMLingua-2-style extractive compression|A small classifier removes less relevant tokens from long prose; multilingual variants and forced-token preservation exist.|CPU overhead, language/domain shift and loss of negations/numbers need measurement. Keep instructions, code and executable schemas exact.|
|7|Schema-specific compact representations|Potentially valuable when schemas alone overflow the budget.|A custom notation needs model/provider support or an adapter and validation. It is not automatically compatible with native Ollama function calling.|

## Primary evidence

- [Anthropic, advanced tool use,2025-11-24](https://www.anthropic.com/engineering/advanced-tool-use): deferred schemas and on-demand search, with 3–5 commonly used tools retained. Anthropic reports85% lower token usage in its illustrated setup and improved internal MCP selection results. These are vendor measurements for Claude; they are not measured gains for our local models.
- [Anthropic, effective context engineering,2025-09-29](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): compaction, durable notes, retrieval and selective context. Start by retaining important information before trimming harder.
- [Anthropic, code execution with MCP,2025-11-04](https://www.anthropic.com/engineering/code-execution-with-mcp): process/filter large intermediate datasets in code and pass concise results to the model. Native tool authorization and sandboxing remain necessary.
- [Microsoft Research,LLMLingua-2](https://www.microsoft.com/en-us/research/project/llmlingua/llmlingua-2/) and [official implementation documentation](https://github.com/microsoft/LLMLingua/blob/main/DOCUMENT.md): learned token classification for extractive compression, multilingual variants, structured compression and forced-token controls. Reported compression ratios cannot be assumed for Polish coding agents without our own tests.
- [Chroma,Context Rot,July2025](https://www.trychroma.com/research/context-rot): controlled experiments show that increasing irrelevant input can reduce performance even when information fits; simple needle retrieval is not a complete long-context evaluation.
- [Sakizli,Tool-Schema Compression Enables Agentic RAG Under Constrained Context Budgets,2026-05-24](https://arxiv.org/abs/2605.26165): exploratory preprint with 14 models and 6,566 calls, reporting44–50% schema savings. Large benefits occur mainly when the original schemas overflow; at 32k most tested models show little quality difference. Treat as research evidence, not a validated Kalio implementation.
- [Liu,What Does Context Compression Cost an Agent?,2026-08-17](https://arxiv.org/abs/2608.16370): preprint showing that task completion alone can hide additional retrieval needed to recover discarded state. Kalio evaluation should measure total tool calls and wall time as well as compressed token count.
- [Ollama context-length documentation](https://docs.ollama.com/context-length): actual runtime capacity is configured separately from application history. More capacity uses more memory; it does not mean every request contains more information.

## Proposed next experiment

Compare full schemas,6-tool static profiles and actual top-k discovery on matched tasks and held-out domains. Then separately compare raw long outputs against selected excerpts, structured summaries and classifier compression. Grade required facts/identifiers/negations, execution correctness, discovery recall, repeated retrieval, latency and memory. Count compressor time and all extra model turns. Do not compress authorization rules, current instructions or tool argument contracts into lossy prose.
