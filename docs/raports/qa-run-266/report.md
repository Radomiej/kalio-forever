# QA266 — live Devin queue; incorrect test assertion

2026-10-04, Europe/Warsaw. FAIL: the harness incorrectly expected `provider` on `llm.turn.started`; that audit event records the model, not the provider. This is not a demonstrated Devin communication failure.

Both UI responses completed and survived F5. Scoped durable journal inspection confirmed turns `K13YruuqblhNNow8yyEMx` and `3s6_jT9GIDEWTlMpi-3lI` as completed, provider `devin-cli-acp`, model `swe-2`. Failure artifacts were copied using absolute paths and byte lengths verified before the next test reset. Trace remains local and ignored by Git.

Correction: verify provider/model/status from `/sessions/:id/runs/history?turnIds=...`, rather than inventing an audit field. The corrected rerun is QA267. This attempt remains FAIL.
