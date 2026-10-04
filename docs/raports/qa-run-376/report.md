# QA376 — app-owned host reset and Codex cold start

Date: 2026-10-04. Target: fixed QA localhost:5288 / API 127.0.0.1:3316. Real Codex gpt-6-luna, ChatGPT auth profile chatgpt-default. Project E:/Projekty/home-site. Existing session yvD83rgDA_ZHvUwJKlo_S. No target file changes, terminal commands or stack restart.

## Acceptance matrix

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| RESET-01 Require explicit confirmation without native window.confirm | PASS | UI Reset opened the app-owned dialog. Native panel test verifies no POST before confirmation. Confirmation completed and UI showed Not started / Disconnected. | Reset HTTP-error path not newly exercised live. |
| RESET-02 Cancel focus, keyboard containment, Escape and restored trigger | PASS | Unit tests cover Tab, Shift+Tab, Escape isolation and focus restoration. Live Escape kept Settings open and restored focus to Reset. Only confirmation controls remained in accessibility tree while open. | Narrow viewport not newly exercised. |
| RESET-03 Do not clip confirmation within Settings scrolling ancestors | PASS | Dialog portal rendered under BODY; fail-first containment regression failed before portal implementation. Parent Settings made inert during confirmation. Screenshot saved. | None for this measured desktop state. |
| CODEX-01 Cold start from user chat without Recheck after reset | PASS | Warm configuration preflight 18/18 PASS, then UI Reset. No Recheck afterward. UI prompt launched a new online host epoch oV0-V2YD0dVs_TTwwgoEx and completed. | Not proof of every model/account or cold OS boot. |
| CODEX-02 One real Kalio file read, no extra writes/native tools | PASS | Scoped audit after 1791145170886 contains one tool_call and one tool_result; runtime request/result toolName fs_read. UI final QA376_CODEX_COLD_RESULT: name nexora-home-site, scripts.build vite build, origin Kalio. /runs/current empty after completion. | Graph/F5 for this exact turn not newly exercised. |
| WIN-01 Observe cold Codex chat startup for transient consoles | PASS (bounded observation only) | Window hook READY before submitting the prompt, finished records=0 over its 30-second window. | User-reported QA/Devin startup windows remain unresolved; process-event permissions blocked in QA375. |

## Verification and deployment

- New dialog regressions initially 2 PASS / 1 FAIL: containment test reproduced rendering inside the parent dialog.
- Final settings regression: 3 files, 24/24 tests PASS (NativeIntegrationResetDialog, NativeCliIntegrationsPanel, SettingsModal).
- `pnpm --filter kalio-web build`: tsc succeeded; Vite build exit 0. Existing large-bundle warning remains (main minified chunk ~2.1 MB).
- Running fixed-QA preview served new built assets without restarting API or Home Site preview. Runtime configuration remains supplied by the preview server middleware.
- Initial readiness failed because the earlier QA375 host reset invalidated its model catalog. Refreshed catalog for the current epoch before repeating preflight. Only after PASS was the cold-start reset performed. No catalog refresh occurred between that reset and the tested prompt.

Screenshots: reset-confirmation.png, reset-offline.png, codex-cold-result.png.

## Implementation

Small app-owned confirmation replaces browser-native confirm. It uses a body portal to avoid Settings clipping, makes the surrounding Settings dialog inert while open, initially focuses Cancel, contains two-button keyboard navigation, isolates Escape and restores prior inert/focus state on dismissal. Existing backend reset action and saved credentials/settings are unchanged.

Verdict: this reset/cold-Codex-read slice PASS at desktop QA. Overarching Devin/Home Site goal remains active. No claim of universal console fix, complete product readiness, Jev goal-loop proof or production readiness.
