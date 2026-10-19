# Configurable generation timeout and runtime fixes

## Behavior

Settings → Runtime Settings → Request and Tool Timeouts now exposes **LLM request timeout (seconds)**, from 1 to 1800 seconds. The default remains 120 seconds. Leaving the input saves it in backend app settings; subsequent provider requests read the effective value without restart. The timeout covers each HTTP attempt, including the response stream. Existing transient retries can extend the total wait; an interrupted partial stream is not replayed. User cancellation remains immediate.

The optional TOML setting is `tool_timeouts.provider_request_timeout_ms`. As with existing timeout settings, TOML-managed values take precedence and cannot be overwritten via the API. Probe timeouts retain their original meaning.

The CLI recovers a runtime lock only when its owner PID is demonstrably gone. Live, unverifiable, malformed and interrupted recovery locks fail closed. A separate exclusive recovery claim prevents competing starters from removing a newly acquired runtime lock. PID reuse can conservatively require manual inspection; recovery never kills another process.

The chat header wraps on phones and the architecture selector takes its own composer row. Send/input/header controls remain reachable at 320 and 390 pixels, with desktop behavior checked at 1440 pixels.

## Verification

- API/web build and workspace typecheck passed.
- Focused API/provider/settings/config regressions: 116 passed.
- LLM settings frontend tests: 52 passed; chat interface tests: 18 passed.
- CLI lock/updater regression tests: 8 passed, including six simultaneous starters.
- Isolated Playwright `chat-responsive-layout.spec.ts` passed, covering 320/390/1440 px and sending Polish text.
- Browser Settings save/reload passed in dev and a locally built production runtime. The local runtime uses a snapshot of the installed data; the official 1.0.2 installation is preserved.
- Real Ollama `lfm2.5:8b`, default persona/full tool set, 32k context, CPU-only: confirmation at 238.043 seconds; exact Unicode VFS file verified at 238.246 seconds; final assistant response completed, no browser errors. The first request continued past the previous 120-second deadline. Local production timeout is 600 seconds.
- Real local HTTP fixture: three stalled generation attempts aborted after approximately 967/999/996 ms with a one-second setting. A two-second response succeeded after increasing the setting. Model discovery probes were observed separately.

## Existing full-suite failures

The full gate is **not green**. `scripts/runtime-scripts.test.mjs` hardcodes release 1.0.0 while the baseline manifests already contain 1.0.1. Full API: 2694 passed, 17 failed, 1 skipped. Full web: 1742 passed, 3 failed. Shared contracts: 16 passed.

The same 17 API and 3 web failures were reproduced in a separate clean archive of baseline `2917ea3`:

- `drizzle.service.spec.ts`: historical migration reconciliation (1).
- `cli-agent-session.service.spec.ts`: metadata contract (3).
- `kv-store.service.spec.ts`: persona KV integration (12).
- `security-policy.service.spec.ts`: critical action human approval (1).
- `ExecutionGraphView.test.tsx`: empty-session/workflow launch state (3).

These unrelated failures are retained for a separate fix; this change does not claim a passing full gate. No GitHub release was published.
