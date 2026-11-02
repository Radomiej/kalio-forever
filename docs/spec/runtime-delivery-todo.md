# Runtime delivery — 2026-11-02

User-requested delivery scope. Production 1.0.5 remains on http://127.0.0.1:4016/; implement and verify changes in isolated DEV first.

## Accepted product decisions — 2026-11-02

1. The initial supervisor uses deterministic rules and one decision model. Guardian is optional; it is not required for every tool call. Existing manual fallback remains available.
2. Enabling an optional feature shows its required backend, download size and an explicit Install action. Download does not start silently on first use. Show progress, ready/error states and retry. Keep model-weight downloads distinct from inference-backend downloads.
3. Web Search settings offer Perplexity with a user-supplied credential or a locally hosted SearXNG service. SearXNG is optional, not an unconditional core-install dependency. Page crawling and extraction are separate capabilities.

These decisions were explicitly accepted by the user; implementation, DEV verification and release remain separate gates.

- [ ] Minimal installer: retain Codex and Devin integrations in core; load Claude backend only when enabled.
- [ ] CLI-only startup: no mandatory `LLM_API_KEY` for Codex/Devin/Claude runtimes. Missing direct-provider credentials fail at direct-provider use with actionable setup guidance, without silently selecting mock. Align DEV launcher, fresh install environment, schema and UI status.
- [ ] Download local embedding inference libraries on demand, separately from Hugging Face model weights. Pin versions and verify integrity; expose install/progress/error/retry states. App must start without optional backends.
- [ ] Measure core archive, full installation, optional components and update downloads separately. Target roughly 70 MB core download; do not claim this until measured.
- [ ] Preserve provider credentials, model selection, embedding indexes and data through install/update. Test cold start, existing instance, desktop shortcut and rollback.
- [ ] Default new local text/code setups to tested EmbeddingGemma 2 270M CPU; retain E5 as lightweight option and preserve existing selections. Images require a separate supported encoder and ingestion tests.
- [ ] Add compatible local/custom decision guardian support. An Ollama chat endpoint is not a Jev Decisions endpoint. No fabricated confidence scores. Hard rules and manual fallback remain authoritative.
- [ ] Evaluate Granite Guardian 4.1 8B Q4_K_M and a smaller baseline with unauthorized-action, injection, Polish/English, timeout and malformed-response cases before auto-approval.
- [ ] Audit Settings UI consistency: runtime/model selection, connection state, Decision Settings, embedding installation and reindex status. Review by Luna using impeccable/design-pityfall.
- [ ] Interrupted chat recovery: expose Resume for server-reported recoverable turns after reconnect/restart, with in-flight duplicate protection. Resume must use durable runtime state and must not replay completed writes or reuse stale approvals. Show actionable guidance when automatic continuation is unavailable. Visually distinguish approval cards from Quick Chat.
- [ ] Web Search: retain existing Perplexity integration; evaluate a self-hosted SearXNG provider separately from page crawling and extraction.
- [ ] Voice input: inspect the existing Skryba project and its Polish speech model (user recalls Parakeet); add browser microphone recording, local transcription and editable prompt text. Evaluate Windows CPU and GTX compatibility, actual download size, Polish quality and latency. Download speech backend/model only through explicit Install UI; microphone starts only from user action. Recording retention must be explicit. Research first; no Android port assumed.
- [ ] Rebase onto current main after agent changes settle; focused regressions, typecheck/build, DEV browser proof, reviewed PR and CI before release.

Board synchronization pending: authenticated Nekko Board tools are unavailable in this session. This local list is a handoff, not a claim of external synchronization.
