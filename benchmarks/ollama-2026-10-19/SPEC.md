# Evaluation and context-budget specification

## Status

This folder records completed measurements and an exploratory follow-up. Discovery Search and semantic compaction below are proposals, not implemented product behavior.

## Controlled follow-up

Models: qwen3.5:2b and lfm2.5:8b, same installed digests as the main benchmark. Temperature0,seed42,4threads; output budgets384/1536 respectively. Run sequentially to avoid model contention. Native options.num_ctx sets the actual capacity. No application history compactor participates.

1. Capacity control: identical short Polish extraction at num_ctx4096 and32768. A larger allocation is not itself additional information or evidence of improved reasoning.
2. Tools: identical system text and PL write/EN read tasks. Compare6 relevant/common schemas versus the archived62-tool catalog. Grade exact function and arguments. No filesystem side effects: this measures selection only, not real tool execution. Unload the model before each condition; the second task may benefit from prefix cache. Report first and second tasks separately, not as equally cold samples.
3. Filled context: fixed32768 capacity;40/300/800 records, with unique target facts at start/middle/end. Polish task retrieves all3codes; English task joins2records and sums units while also retrieving a code. Score exact JSON and field-level correctness. Actual prompt_eval_count, output truncation,TTFT, prefill duration and wall time must accompany scores. Unload before each record count; the second task may reuse cache. This is synthetic retrieval/multi-hop evidence, not general long-document comprehension.

4. Focused baseline: the same questions with only the3target records. This is an oracle-selected excerpt baseline, not a measured production retriever or learned compressor; it helps distinguish distractor effects from reasoning errors. Run only this supplement with `python3 experiment.py --focused-only`.

No condition intentionally exceeds capacity. Check prompt counts/logs for truncation. One task/language/condition is exploratory; do not turn small differences into a definitive ranking.

## Discovery design proposal

Current list_tools/get_tool_details are informational; the runtime still advertises every allowed schema each iteration. list_tools filters names only, not descriptions. get_tool_details formats text and does not activate a schema. Reducing the same list also hides tools from discovery, so a rename alone saves no tokens.

Maintain separate backend-owned sets:

- Allowed catalog: result of persona/MCP/runtime authorization, never the unrestricted global registry.
- Advertised active schemas:3–6 common tools plus discovery; add at most3–5 relevant schemas on search.

Search should rank names/descriptions/examples with a bounded result count. BM25 or exact/domain routing is an appropriate first baseline; embeddings/reranking must earn their added latency in evaluation. Preserve exact schemas for selected tools, valid names and argument validation. Persist activation so reconnect/F5 reconstructs the same state; recheck authorization at execution; preserve HITL for destructive tools. Do not implement discovery by bypassing dispatch allowlists.

Start by shipping and measuring static persona profiles. Benchmark discovery against them on known and held-out domains, including synonyms in Polish/English, missing tools, ambiguous names, permission denial, user cancellation and reload.

## Context compression acceptance criteria

Prefer removing irrelevant schemas and bounded tool outputs before lossy text compression. Preserve current task, user constraints, IDs/paths/numbers, decisions, open errors, test evidence and outstanding approvals. Store full outputs durably and supply stable references for retrieval. Never summarize approvals or execution outcomes into invented success.

Measure end-to-end time, token counts, correctness, retrieval recall, additional tool calls required to recover discarded state, memory, user cancellation and restart/reconnect behavior. Compression overhead belongs in the measurement. Prefix caching reduces repeated computation; it does not make the logical context smaller or improve quality by itself. Quantized KV cache reduces memory, not input token count.
