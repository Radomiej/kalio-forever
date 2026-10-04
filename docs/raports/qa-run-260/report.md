# QA260 — durable native-audit provenance fixture

2026-10-04, Europe/Warsaw. PASS for one isolated native-audit browser regression.

QA257's fixture seeded Devin approval events and messages but omitted the exact durable run provider. The production panel correctly hides unknown providers after QA254. The fixture now seeds a completed `chat_runs` entry for the same session/turn with `devin-cli-acp`, `swe-2` and runtime kind `chat`; it does not change production inference or persona defaults.

System Node outside sandbox, one worker, existing built artifacts:

`node scripts/run-playwright-with-stack.mjs regression-native-tool-audit.spec.ts --project=chromium --workers=1 --reporter=line`

`KALIO_PLAYWRIGHT_SKIP_BUILD=1`, `KALIO_NATIVE_AUDIT_REPORT_RUN=260`; isolated UI/API `50631/50632`. **1 passed (2.3s), exit 0**, 15:22:33.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Scoped persisted audit | PASS | Exact turn shows approved and policy-blocked entries; other-turn entry excluded | Fixture, not actual native execution |
| F5 and mobile | PASS | Reopened after F5, width 390, no horizontal overflow | Other viewport/runtime combinations not claimed |
| Unknown/Codex provider exclusion | Prior separate evidence | QA254/255 | Not rerun by this Devin-only fixture |

Screenshot `assets/native-audit-fixture-390.png` was visually inspected: approved versus blocked labels remain readable; the panel explicitly states that approval does not prove execution. The header says Local LLM because session configuration is deliberately not a live Devin profile: this fixture proves per-turn journal provenance, not a connected live host. No fixed QA reset/deploy, provider change or real Devin prompt occurred.

Together QA258–260 recover 11 of QA257's 37 failed cases in focused serial runs. The other 26 are still unresolved; the full gate remains NO-GO pending repair and rerun.
