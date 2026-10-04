# QA356 — real Devin build, Home approval after F5

2026-10-04 fixed QA5288/API3316, real Devin swe-2 session W4fggLSunrJB41C24MV7C. Cold static readiness passed17 checks before prompt. Requested one npm run build in E:/Projekty/home-site, no writes/native tools/preview.

Observed pending arguments in chat, navigated Home and reloaded. Home restored exactly one terminal_spawn approval with the approved cwd. Clicked Approve once in Home. Persisted audit since1791141278681 shows one requested/confirmed approval, one terminal_spawn call/result, one process.cmd.invocation, one terminal_output call/result and ACP/LLM turn completion. UI final reports terminal _SD97LH6Qw-b84YAW3qHR exited0; Vite5.4.21,26 modules,468ms, JS index-JVnkUbD4.js, CSS index-BbCSJmRq.css. Screenshot build-result.png.

| AC | Status | Evidence / remaining |
| --- | --- | --- |
| Real Home approval hydration after browser F5 | PASS | One pending action without reopening chat first |
| Approval from Home invokes command once | PASS | One confirmation and process invocation |
| Agent receives tool result and finishes | PASS | ACP/LLM completion and UI build result |
| Home Site corrected source builds | PASS | exit0 |
| Approval recovery after backend process loss | UNVERIFIED | This test kept backend/ACP alive |
| Resize/form browser regression | UNVERIFIED | Preview must be restored after QA restart |
| No transient console windows | UNVERIFIED | No OS event hook in this attempt |
