# QA300 — inspector completion label regression

2026-10-04. Local frontend fixture tests only, fixed QA not rebuilt/restarted. Traced QA299 READY: ExecutionGraphInspector.statusLabel explicitly mapped success to ready. Runtime graph status itself was success; no lifecycle repair required.

Changed this display mapping to completed, shared by inspector node header and grouped tool summaries. No model, persistence, layout or grouping changes. Component419 LOC before edit. Files clean before this scoped edit.

System Node/Vitest outside sandbox: regression RED1 failure/23 passes because completed was absent, then minimal mapping fix GREEN24/24 exit0. The existing prompt-node fixture exercises the shared mapping; broader grouped-tool regression and QA browser proof remain required.

| AC / PIT | Status | Evidence | Remaining |
|---|---|---|---|
| Completion wording / PIT-07 | PASS locally | Traced success-to-ready mapping, RED/GREEN | Browser QA deployment |
| Grouping / PIT-02 | Unchanged | No node/model additions | Group inspector proof after build |
| Regression / PIT-34 | PASS | RED1/24, GREEN24/24 | Other terminal/negative states |
| Provenance / PIT-13 | UNVERIFIED | No guessed Kalio origin added | Propagate actual provenance contract |
| Exact runtime / PIT-11 | UNVERIFIED | Current QA still old frontend dist | Typecheck/build/deploy before claiming fixed in QA |

Verdict: local wording regression PASS, parity issue incomplete. Design-pityfall guard kept runtime state separate from presentation and prevented inventing missing provenance.
