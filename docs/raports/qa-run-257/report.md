# QA257 — full Chromium regression sweep

Date: 2026-10-04, Europe/Warsaw. Status: NO-GO; completed with failures.

## Boundary

- Checkout: `codex/kalio-provider-runtime-ux`, HEAD `eaececaf`, with existing uncommitted changes. This is mixed-checkout evidence, not a clean-commit acceptance run.
- System Node; isolated runner storage `data/playwright-stack/1791118575873-34520/`; initial API `http://127.0.0.1:54429`.
- Command from `apps/e2e`: `node scripts/run-playwright-with-stack.mjs --project=chromium --workers=2 --reporter=line`, with `KALIO_PLAYWRIGHT_SKIP_BUILD=1` and `KALIO_THINKING_REPORT_RUN=257`.
- 232 discovered Chromium cases, two workers. The default is one worker; shared-setting interference must be excluded with focused serial verification before attributing failures to application code.
- Existing built artifacts; no source/test edits during execution. Fixed QA was not restarted. This mock/fixture sweep does not replace real Devin or Codex acceptance.

## Observed findings, pending final totals

| Priority | Finding | Evidence | Next |
|---|---|---|---|
| P2 | Multiple old empty-chat fixtures cannot send through the new creator without an eligible execution profile. | `welcome-run-prompt` disabled in AC01, AC10 and several architecture cases; helper fails at `test-config.ts:230`. | Inspect each fixture; seed explicit isolated mock profiles/history where appropriate. Do not expose mock in the production picker merely to satisfy tests. |
| P2 | Full browser gate is not green. | Failures already observed; final passed/failed/skipped counts unavailable while process is running. | Preserve failure artifacts and classify all failures after the terminal result. |

The latest observed case was 134/232, `architecture-multi-ui-replay.spec.ts`; this test declares a 420-second timeout. A quiet output interval is not proof of a dead process. Runner PID 34520 remained present on a subsequent read-only check.

## Related user decisions

User notes: `docs/meetings/2026-10-04-user-notes.md`. Jev goal-loop proposal: `docs/spec/jev-devin-goal-loop.md`. Neither automatic note archival nor the proposed Jev loop is proven implemented by this sweep.

## Acceptance

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Full Chromium sweep | IN PROGRESS / already not green | Existing failures; same live runner retained | Terminal summary and preserved artifacts |
| Fixed QA availability | PASS, HTTP boundary only | Read-only UI/API requests succeeded during sweep | This does not prove a new agent turn |
| Real Devin/Codex | Not rerun in QA257 | Prior evidence is in QA245–247 and QA255 | No new live-provider claim |

## Terminal result

Runner terminated normally with exit code 1 at 15:13:12: **127 passed, 37 failed, 67 skipped, 1 did not run**, total 232, 16.9 minutes. It was not restarted. Earlier IN PROGRESS rows above describe observations during execution, not the final verdict.

112 PNG/context/trace artifacts were copied into `failures/` with source/destination byte-length verification before the next run reset `test-results`. PNG and Markdown evidence are versioned; approximately 188 MB of `trace.zip` files remain local and are narrowly gitignored. No secret-bearing provider settings were exported.

| Failed spec | Failed cases |
|---|---|
| ac-01-streaming | streamed response; server error recovery; SESSION_NOT_FOUND |
| ac-02-hitl-confirmation | tool name and arguments |
| ac-08-ws-error-handling | error banner; streaming recovery; send after error |
| ac-10-streaming-visible | visible stream; chronological turns |
| ac-12-reload-history | history after reload |
| ac-13-anti-spam | queued second message; rapid Enter queue |
| ac-21-session-title | auto-title after first reply |
| ac-26-history-reload | prompt and answer after reload |
| agentflow-goal-guard | Talk launch and result graph; durable child completion/reload |
| architecture-chat-subagent-turn | sequential chain; Architect variant through Talk; council branches; persisted envelope; Debate launch/project scope |
| architecture-follow-up-stability | stable previous bubble/real children/reload |
| architecture-multi-ui-replay | second browser restores host/children/notes |
| architecture-structured-output-failure | malformed router output terminal state |
| hitl-settings-modes | manual tool and RA-App confirmation |
| hitl-tool-confirmation-runtime | manual blocking; same-turn restart recovery |
| llm-panel | env fallback after saved credential |
| mock-tool-intent-fallback | Preparing raapp_create |
| paid-live-canary | single-node no-tool launch/reload |
| proof-workflow-architecture-label | header/sidebar label |
| regression-full-tool-arguments | long confirmation mobile/tablet/reload |
| regression-mock-llm-429-recovery | deterministic 429 recovery |
| regression-native-tool-audit | scoped SQLite native audit/F5 |
| subconversation-live-hitl | child manual restart recovery; child auto-approval |
| workflow-stop-runtime | Stop after workflow launch |

The native audit fixture contains approval entries but no durable turn provider. The current UI correctly refuses to infer Devin from unknown turn provenance; fixture repair remains pending. Cleanup exceptions in timed-out tests can obscure the primary failure, so inspect retained context/trace before attribution. Other failures are not all classified as fixture issues; parallel shared settings and actual application behavior remain to be checked.

QA258 repairs and serially verifies the six AC01/AC08 cases. That closes only those six cases, not this full gate. Fixed QA was not redeployed for test-only changes.
