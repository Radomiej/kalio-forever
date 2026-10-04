# QA243 — ACP initialization barrier

2026-10-04. Local backend fix, not deployed yet.

[P1] Devin ensureConnection returned an assigned transport before awaiting a still-pending ACP initialize request. A simultaneous session/capability request could use it prematurely. Registry itself reserves hosts synchronously and startup reserves its promise before awaiting config; the Codex duplicate-start race was not found here.

Fix: check/await starting before returning an existing transport. No API, persisted schema, permissions, model or tool policy changes. Added regressions for pending initialize and initialize failure. RED 14:25:12: capability request resolved before barrier. GREEN: 6 host tests, then 33 tests / 5 files, 2.03s at 14:26:53, covering startup guard, shutdown, registry and LLM source. Backend tsc exit0; build zero TSC issues, 680 files compiled.

Boundary: fixture-level lifecycle proof and compiled artifact. Fixed QA still uses previous backend; no restart or target preview interruption in this attempt. Controlled deployment and real cold-start Devin UI proof remain required. Historical CMD-spam causation is not established by this finding.
