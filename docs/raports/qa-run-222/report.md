# QA222 — Settings Codex Recheck refreshes its catalog

Date: 2026-10-04. Local frontend correction for the real QA221 observation; not yet built or deployed in this run.

`NativeCliIntegrationsPanel.runAction` now follows successful manual Codex host check with the existing `/models/check` operation and uses its returned models for the card. Both per-integration and all-integrations checks use this shared path. Reset and non-Codex checks are unchanged. Automatic status loading/polling remains read-only.

| Acceptance / pitfall | Status | Evidence / remaining |
| --- | --- | --- |
| Regression detects old missing catalog call / PIT-34 | PASS | New assertion failed against old behavior: 1 failed, 13 skipped, start 13:30:08. Sandbox EPERM before that was infrastructure, not regression evidence. |
| Panel tests after fix | PASS | 15 tests, 1 file, 1.66s; start 13:31:26, exit 0, system Node outside sandbox. |
| Explicit-only checks / PIT-03 | PASS locally | Existing mount/poll tests remain green; shared manual check invokes catalog endpoint. |
| Catalog failure / PIT-03 | PASS locally | Injected HTTP 503 yields explicit alert; no reset call. Initial test selector matched two intentional copies of error text and was narrowed to the alert. |
| Typecheck | PASS for source fix | `tsc --noEmit` exit 0 after source change, before adding the final negative test; rerun after final test still required. |
| Exact QA artifact / PIT-04, PIT-11 | UNVERIFIED | Fixed QA still serves QA216 build; this source change not deployed. |
| Real Settings Recheck → fresh catalog / PIT-05, PIT-18 | UNVERIFIED | Requires build, deployment and real browser/catalog timestamp and epoch proof. |

No target Home-site edits, backend changes, provider settings mutations or host resets. Source plus tests remain uncommitted. No screenshot captured for this local-only slice. Existing client endpoint verified from `codexModelClient.ts`; no new API or shared contract added. Full goal remains open.
