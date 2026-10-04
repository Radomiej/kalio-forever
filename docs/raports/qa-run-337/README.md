# QA337 — remove build transforms from managed built preview

2026-10-04. Fixed QA 3316/5288. Change: managed preview now loads a plain JavaScript preview-only config with `--configLoader native`, without React/Tailwind build plugins or the TypeScript runner. Manual DEV config unchanged. Runtime config behavior intentionally mirrors DEV (API/WS environment, no-store). No dependency edits.

Regression test first failed on the previous runner launch. After fix, 36/36 runtime-script/diagnostic tests passed. Controlled restart under the same event capture method: 45-second hook ready before restart, exit 0, zero console/Terminal records (QA336 captured three events and attributed conhost to preview esbuild).

Backend PID 45956, frontend PID 49860; managed state confirms native preview config. API/UI/runtime-config.js HTTP 200. Runtime config API+WS both http://127.0.0.1:3316, Cache-Control no-store. Browser F5 initially showed connecting/empty state, then hydrated existing chat UI; screenshot qa-after-preview-fix.png is after hydration.

SHA256 ordered-row comparison against the pre-QA336 online backup: credentials, execution_profiles and app_settings unchanged. Scoped Devin/Codex runs were idle before restart. No native tool settings, tokens, provider credentials or Home Site source changed.

| Acceptance | Status | Evidence / remaining |
| --- | --- | --- |
| Remove preview config transformation path | PASS | Native .mjs config without build plugins |
| Start fixed QA without captured console events | PASS for this attempt | 45-second event capture, zero records |
| Preserve live frontend runtime routing | PASS | API/WS 3316 and no-store verified over HTTP |
| Browser hydration | PASS | Existing chat UI after F5 |
| Preserve providers | PASS | Three tables unchanged |
| Devin cold ACP startup and historical flashes | UNVERIFIED | Separate live boundary; do not generalize one QA restart |

Real Home Site preview may require restoration after managed restart. Overall user goal remains incomplete. No production release or full frontend regression suite claimed.
