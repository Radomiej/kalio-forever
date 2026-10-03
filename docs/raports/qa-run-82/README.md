# QA run 82 — observed Devin startup without owned CMD starts

2026-10-03. Fixed QA5288/3316; API listener owner62388 verified outside sandbox. Existing HomeSite sessionW4fggLSunrJB41C24MV7C, approved projectE:/Projekty/home-site, explicit exact Devin ACP swe-2. Preserving host reset and16/16static readiness preceded one UI request: only Kalio fs_read package.json. No terminal/write/build/preview requested.

## Process evidence

Existing read-only scripts/measure-qa-process-starts.ps1 was inspected and reused. Windows denied Register-CimIndicationEvent Win32_ProcessStartTrace outside sandbox; event-mode command exited1 before model request. No administrator/security changes were attempted. Poll mode60s started with MONITOR_READY before sending prompt.

Window:2026-10-03T08:34:44.2251980Z–08:35:44.9712210Z. TurnZKU60NF8v3WTjv6xh3CrY started inside it at1791016508637, completed1791016513375. Thus this sample covers actual host initialization, tool execution and completion, not just an idle aftermath.

| Measure | Result | Interpretation |
| --- | --- | --- |
| Initial owned CMD |17528/47956 |Existing HomeSite preview; not new starts |
| New owned starts |8 |git9564/conhost26820, devin26512/conhost27600, devin59684/conhost57700, node51580/node19996 |
| New owned CMD |0 |No repeated CMD launch observed under QA during this actual run |
| New CMD outside ownership tree |5 |62632/50980 parent24600;45168/49232 parent30632;26812 parent45168. Ownership outside QA, origin not investigated |

Limits: polling can miss short-lived processes; no PID-reuse guarantees; no event-based proof or all-run guarantee. No command lines, environment values or credentials were collected. Do not claim absence of CMD across the whole machine or complete native-hook isolation.

## Communication evidence

Rendered final: nexora-home-site / vite build with fs_read marked Kalio. Audit tool_result success, providerToolCount0 at declaration boundary, swe-2 runtime start/completion. Scoped current run empty after completion. Native filesystem/web/terminal remaineddisabled; bridgeenabled, credentialsunchanged.

Durable final-chat proof: canonical run-playwright-with-stack runner, skip-build, qa-home-site-chat-live-audit.spec.ts, report82. One test PASS4.0s (test3.2s), helperAPI49511/UI49507; actual fixedQA5288 tested with F5 at320/390/820. Screenshotsassets/completed-real-chat-{320,390,820}.png. No Stop/responding/stale pulsing Thinking or horizontal overflow. Runner exit0 verified; startup output truncated. Test is read-only and does not submit a model request.

DEV preflight: UI5188 request timed out after3s; API3016 connection refused. No DEV process killed or reset. Next iterative implementation should use separate DEV AppData profile, while fixed QA remains the user-facing verified environment.

Whole goal remains active. Required next: real ChatGPT/Codex communication validation, remaining relevant Devin lifecycle/policy proof and review/commit of existing owned source changes. Secondary UI work remains delegated/deferred. No new application source fix was warranted by this observed run.
