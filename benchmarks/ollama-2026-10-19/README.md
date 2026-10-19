# Ollama: Polish, English, tools and code

Measured 2026-10-19. Hardware: 4 vCPU quota, 16 GiB RAM, no GPU; Ollama0.40.6. These are cloud measurements, not the user's computer. Application baseline:2917ea3; timeout/mobile fixes were subsequently validated separately. The release candidate includes newer runtime code, so these model scores do not certify every1.0.3 workflow.

## Main benchmark

12 unique tasks ×2 repetitions ×5 models =120 trials. Each category has6 trials/model. Passing requires the requested format and factual correctness; generated Python is executed against independent assertions, including non-mutation and boundary cases. Tool trials require both correct function arguments and correct interpretation of the supplied result. Manual factual review decisions are included in manual-overrides.json.

| Rank | Model | Polish | English | Tools | Code | Total | Median | P95 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
|1|LFM2.5 8B|2/6|4/6|6/6|6/6|18/24|8.95s|23.42s|
|2|Gemma4 E2B|3/6|4/6|6/6|4/6|17/24|6.64s|34.99s|
|3|Qwen3.5 2B|4/6|4/6|6/6|2/6|16/24|3.16s|8.93s|
|4|Granite4.2 3B|2/6|3/6|6/6|3/6|14/24|3.69s|11.65s|
|5|Qwen3.5 4B|2/6|2/6|6/6|2/6|12/24|4.97s|14.94s|

| Model tag | Quantization | Generation tokens/s | Measured runner RSS,4k context |
|---|---|---:|---:|
|lfm2.5:8b|Q4_K_M|32.81|4.96GiB|
|gemma4:e2b|Q4_K_M|7.99|4.89GiB|
|qwen3.5:2b|Q8_0|18.11|2.74GiB|
|granite4.2:3b|Q4_K_M|20.79|2.49GiB|
|qwen3.5:4b|Q4_K_M|12.19|3.48GiB|

Temperature0, seed42,4 inference threads, native context4096. LFM uses thinking with1536 output tokens; other models use think:false with384. This is a practical configuration comparison, not an equal-reasoning-budget study. No final main-benchmark transport errors or output truncations were observed. Twelve tasks and two deterministic repetitions are too small for a general language-quality ranking or statistical significance claim.

Memory is runner RSS from the host/container process, not the model's reported /api/ps size; the latter understated Gemma. RSS depends on context, cache and runtime and must not be extrapolated unchanged to32k.

Recommendation: LFM for code/tool tasks; Qwen2B for responsive Polish conversation; Granite when memory matters; Gemma as an alternative general model. The tested4B Qwen did not justify its additional cost on this sample.

## Kalio integration evidence

The default62-tool catalog takes roughly11.6k estimated tokens, about13k including system/user input. A4k Ollama window truncated it and led to incorrect argument names. Increasing only Kalio's history budget does not enlarge Ollama's actual window. With both configured around32k, cold CPU prefill exceeded the old120-second provider deadline.

With the configurable provider deadline set to600seconds, real LFM/default-persona frontend QA reached a correct vfs_write confirmation at238.043s and verified the exact Unicode file content at238.246s. The final response completed. A restricted3-tool VFS persona previously reached the confirmation in22.685s and verified the file in22.942s. These app runs are illustrative, not a controlled same-prompt A/B pair.

## Controlled tools/context follow-up

See [specification](SPEC.md), [compression research](compression-research.md), and context/results.jsonl. The follow-up compares identical instructions and tasks with6 versus62 native tool schemas, tests4k/32k capacity on the same short input, and separately increases actual input length at fixed32k. The completed follow-up has28requests:24matrix trials plus4focused controls; see the tables below.

## Reproduction and data

- summary.json, reviewed-results.jsonl and manual-overrides.json contain the reviewed main results. Internal model thinking text is omitted from the public export; its character count and generation metrics remain.
- benchmark.py contains original prompts, expected answers, tool fixtures and Python assertions. review.py and summarize.py record grading/aggregation.
- context/experiment.py and context/tool-catalog.json freeze the follow-up protocol and schemas. Native requests use options.num_ctx; model settings in the Kalio UI alone are insufficient.
- Launch Ollama with enough RAM and run scripts from their directory. The Python assertion runner uses Linux resource limits. Run generated code only in an isolated evaluation environment.

## Follow-up results: schemas

Native32k window in both conditions, same system instruction and exact PLwrite/ENread tasks. First request starts after model unload; model loading is included. The second task may reuse prefix cache and is reported separately in context/summary.json. Background setup/verification can introduce cloud CPU noise; treat latencies as indicative, not isolated microbenchmark precision.

| Model |6tools input tokens / first latency|62tools input tokens / first latency|Input reduction|First-request speedup|Correct calls6/62|
|---|---|---|---:|---:|---|
|Qwen3.5 2B|936 /16.18s|12,045 /149.63s|92.2%|9.25×|2/2 and2/2|
|LFM2.5 8B|700 /20.99s|11,263 /153.99s|93.8%|7.34×|2/2 and2/2|

This tests relevant static schemas, not discovery recall, hidden domains or full execution. Both tasks need VFS tools already included in the6-tool profile. All8 tool-selection trials passed; no claim is made that6tools support every task. The previous real frontend VFS test is separate execution evidence.

## Follow-up results: capacity and actual context quality

At4k and32k capacity, the same short extraction was correct for both models. The actual input stayed52tokens for Qwen and46for LFM. Increasing capacity alone did not improve the answer. This control is one prompt/model, not broad statistical evidence.

At fixed32k capacity, the same3target records were placed at beginning/middle/end among40/300/800records. PLasks for3codes; ENasks for a sum and a code. Tokenizers differ, so identical records produce different actual token counts.

| Model |Actual input tokens|Correct PLfields /3|Correct ENfields /2|First PLrequest latency|
|---|---:|---:|---:|---:|
|Qwen3.5 2B|1,240|3|1|21.11s|
|Qwen3.5 2B|8,973|3|1|124.88s|
|Qwen3.5 2B|23,840|3|1|339.13s|
|LFM2.5 8B|964|3|2|30.13s|
|LFM2.5 8B|6,832|2|1|149.48s|
|LFM2.5 8B|18,133|1|0*|277.43s|

*LFM's last ENattempt used its1536-token output budget without producing final JSON (done_reason:length,121.25s). Count this as a practical failure, not as proof that both facts were factually wrong. Its PLfailures and6.8k ENfailure ended normally and contained missing/wrong facts. No condition intentionally overflowed the32k input window. The comparison holds output budgets constant, so it includes the practical interaction between longer inputs and bounded reasoning.

Qwen retained all3literal codes even at23.8k, but gave the wrong sum with distractors at every tested length. LFM handled both short tasks, then lost facts as input grew. These are two synthetic task types, not a comprehensive long-context benchmark or a replacement for the original code/language ranking.

## Focused excerpt control

With only the3relevant records, both models passed both questions (5/5fields):

| Model |PL/ENinput tokens|PLlatency|ENlatency|Result|
|---|---|---:|---:|---|
|Qwen3.5 2B|147 /146|7.58s|3.69s|2/2tasks|
|LFM2.5 8B|131 /129|20.12s|7.13s|2/2tasks|

This is an oracle-selected excerpt baseline: the harness knows which records matter. It demonstrates the potential benefit of removing distractors, but does not measure a real retriever's recall, compression overhead or discovery accuracy. Those costs must be included before claiming a production speedup.

## Decision

Use LFM for coding/tool work with compact, relevant context; consider Qwen2B for responsive conversation and literal retrieval, subject to task tests. Start with small persona tool profiles. Next implement backend discovery that separates the authorized catalog from advertised schemas. Reduce large tool outputs and retrieve relevant excerpts before adding learned lossy compression. Preserve complete source artifacts for recovery and evaluate extra retrieval costs.

A32k window remains useful to prevent truncation when large inputs are actually necessary. Filling it with more text did not improve these answers; relevance mattered more than allocated capacity. Longer-context memory/RSS was not measured in this follow-up, so the4k memory table must not be reused as a32k estimate.
