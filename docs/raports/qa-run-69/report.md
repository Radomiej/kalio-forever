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

Authorized canonical start-qa.ps1 -SkipBuild -ForceRestart deployed the gated API. API30844/frontend49136, launcher2940/handle85151; fixed UI5288/API3316 and persistent AppData QA retained. Final typecheck PASS. Home Site/QA data and foreign image-agent changes are not edited by this slice.

Actual UI turn asrU1dPgAknUENXySkIpF resumed exact swe-2 and completed one Kalio fs_read of Home Site package.json: nexora-home-site, vite build. Scoped audit recorded6 Kalio/0 provider declarations, session.resumed swe-2, llm.turn.completed toolCallCount1. No target writes or terminal calls in this canary.

Polling07:06:13.6249400Z–07:06:59.2151015Z, API root30844:8 owned starts,0 owned CMD starts, no owned Serena/Python startup. One unowned CMD41144/parent13236 observed. Three observed short CLI processes42632/44532 and final ACP5820, plus conhosts and bridge Nodes7020/26112; version/list preflight probes remain bounded to three total calls (one may finish between samples). Baseline only API. Compared with QA67's2 owned CMD starts and Serena, this supports the discovered-MCP startup improvement, not a universal no-console guarantee. Polling misses short-lived processes and does not prove command semantics or PID-reuse safety.

Opaque SHA256 comparison of global Devin config.json and mcp_config.json before restart and after this real run: both unchanged. No raw configuration/credentials printed. Existing Home Site preview59857 was stopped by the stack restart. A separate UI-reviewed/once-confirmed Kalio terminal_spawn restored preview at http://127.0.0.1:53601/, terminal MlVt7wC_jpL_LlGfLCEDs. Raw terminal_output: running, exitCode null, Vite preview URL53601. No target writes/build/deploy requested.

Actual fixed-QA chat F5 test320/390/820 passed1/1,4.5s after the read canary. Combined final run against actual fixed QA and actual preview53601 passed3/3 (runner cleanup exit0). Screens under assets/; completed chat320/820 visually inspected. No stale Stop/responding/pulsing Thinking or horizontal document overflow. Home Site functional/keyboard/demo-form/reduced-motion and320 hero-word gates passed again. Random mock runner stack is incidental, not inference evidence.

Separate startup log issues: Kalio MCP connections toml::data-analyst and toml::playwright-orchestrator report fetch failed. They are not Devin native MCP and are not fixed by this host-overlay change; no global MCP configuration is changed to disguise them.

Supporting vendor contract: [MCP configuration](https://docs.devin.ai/cli/extensibility/mcp/configuration) documents local overlays and disabled entries. Actual CLI/catalog/process gates above, not documentation alone, are the evidence for this deployment.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Private MCP catalog suppression | PASS for discovered names | Official CLI16 suppressed/1 allowed; actual ACP sample0 owned CMD/no Serena | Race/global hook boundaries remain |
| Fail-closed parsing/probe/write verification | PASS local |26 unit tests | User-facing runtime error recovery |
| Real SWE-2 still uses Kalio bridge | PASS | UI/audit turn asrU1dPgAknUENXySkIpF | Additional write/approval/reconnect states separately |
| Native/global complete isolation | UNVERIFIED | Explicit boundary above | Hooks/plugins/native capability and race-proof isolation |
| Full Home Site/UX objective | UNVERIFIED | Previous reports/spec | Full requirement matrix, remaining changes and release gates |

[P1] Complete-isolation claims must remain blocked until hooks/native/startup proof. [P2] Upgrade to another CLI version requires a newly validated catalog format; current guard deliberately blocks rather than silently inheriting MCP.
