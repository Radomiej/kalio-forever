# QA395 — current real Codex/ChatGPT communication

2026-10-04. Fixed QA localhost:5288. Existing session yvD83rgDA_ZHvUwJKlo_S, profile codex-local-1bd82ba45243e8a3a0c4aa0478538f67, gpt-6-luna, approved Home Site project/persona and six Kalio tools.

Initial static readiness found host not online/catalog unavailable after previous QA restart. Native runtime UI showed Not started, 0 sessions, external MCP blocked. Scoped Codex Recheck restored online host and current-epoch model catalog; subsequent static readiness all 19 rows PASS. No Devin reset or provider modification.

Submitted QA395 prompt through existing session UI, requesting one Kalio fs_read of package.json. Real final QA395_CODEX_RESULT reports name nexora-home-site and scripts.build vite build. Latest bubble contains one fs_read labelled Kalio; Stop count zero; scoped current-run endpoint returned empty. Screenshot codex-result.png preserves result. No write, terminal, install or target change requested.

PASS for this real communication/read/completion slice. Exact backend tool-count and model-event correlation, F5 and graph parity for this fresh turn remain to inspect; prior readiness binds model but does not substitute for live event identity. Startup-window attribution and Jev goal loop remain open. Overall goal active.
