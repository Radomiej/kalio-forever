# QA run 69 — private suppression of inherited Devin MCP

## Change

Before ACP spawn, Kalio creates its private project overlay, checks supported Devin3000.11.1, inventories MCP once, writes disabled placeholders for all non-Kalio names in both owned local config files, then verifies the catalog once. No per-server CLI loop, global file reads in the API, global edits, auth-root redirection or model fallback. CLI commands are shell-free/hidden,15s timeout and256KiB output cap; raw catalog/errors never enter logs. Unknown/partial catalog, unsupported version, failed write or ineffective suppression blocks ACP startup. Empty/unrecognized catalogs intentionally fail closed.

This is suppression of discovered names, not complete config isolation. Newly added global names between verification and ACP startup, inherited global hooks/plugins/organization policy and native capabilities remain separate boundaries. User config/authentication roots are preserved.

## Local evidence

- Parser initial RED: module missing. First actual-CLI parser run rejected the observed two-space disabled suffix; exact observed grammar correction then passed. This is new-feature validation, not a reproduced prior production regression.
-26 focused unit tests PASS across parser, suppression, existing config/host and startup failure/reset guard (24 together,2 guard separately). A fixture-only failure was corrected by preserving execFile's custom promisify contract; another by using a partial model-catalog mock. Neither required production weakening.
- Actual official CLI:3 opt-in tests PASS,2.70s including parser unit run. Bulk suppression verified16 inherited names disabled, one scoped dummy bridge enabled. Temporary config cleaned. No ACP inference/process-isolation claim from this catalog test.
- API tsc PASS; Nest build0 TS issues, SWC672 files. Final typecheck after test-only mock correction recorded separately.
- Startup failure cleans overlay before rejection; concurrent close during preparation never spawns ACP and cleans once (2 guard tests PASS).

## Deployment / acceptance

Deployment and actual startup-process observation pending. Existing fixed QA remains on the previous loaded API until an authorized restart; source/build success does not imply live deployment. Home Site/QA data and foreign image-agent changes are not edited by this slice.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Private MCP catalog suppression | PASS | Official CLI16 suppressed/1 allowed | Actual ACP startup process proof |
| Fail-closed parsing/probe/write verification | PASS local |26 unit tests | User-facing runtime error recovery |
| Real SWE-2 still uses Kalio bridge | UNVERIFIED for this build | QA67 proves prior build only | Gated restart and UI-driven read canary |
| Native/global complete isolation | UNVERIFIED | Explicit boundary above | Hooks/plugins/native capability and race-proof isolation |
| Full Home Site/UX objective | UNVERIFIED | Previous reports/spec | Full requirement matrix, remaining changes and release gates |

[P1] Complete-isolation claims must remain blocked until hooks/native/startup proof. [P2] Upgrade to another CLI version requires a newly validated catalog format; current guard deliberately blocks rather than silently inheriting MCP.
