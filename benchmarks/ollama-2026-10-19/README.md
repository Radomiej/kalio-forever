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

See [specification](SPEC.md), [compression research](compression-research.md), and context/results.jsonl. The follow-up compares identical instructions and tasks with6 versus62 native tool schemas, tests4k/32k capacity on the same short input, and separately increases actual input length at fixed32k. Results and interpretation are appended after the run.

## Reproduction and data

- summary.json, reviewed-results.jsonl and manual-overrides.json contain the reviewed main results. Internal model thinking text is omitted from the public export; its character count and generation metrics remain.
- benchmark.py contains original prompts, expected answers, tool fixtures and Python assertions. review.py and summarize.py record grading/aggregation.
- context/experiment.py and context/tool-catalog.json freeze the follow-up protocol and schemas. Native requests use options.num_ctx; model settings in the Kalio UI alone are insufficient.
- Launch Ollama with enough RAM and run scripts from their directory. The Python assertion runner uses Linux resource limits. Run generated code only in an isolated evaluation environment.
