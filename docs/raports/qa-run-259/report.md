# QA259 — visible streaming and durable history

2026-10-04, Europe/Warsaw. PASS for the five isolated Chromium cases; not full release acceptance.

## Cause and repair

AC10, AC12 and the UI case of AC26 created empty chats without eligible profiles. QA257 proved these four cases failed before reaching their tested behavior. They now use the explicit isolated existing-conversation fixture from QA258. Mock remains absent from normal production model selection; no production source or fixed QA data was changed.

Assertions were adjusted so fixture initialization cannot count as a tested response:

- AC10 observes a uniquely marked partial answer while Stop is visible, then the complete answer with Stop absent and no current run. The persisted last assistant message must equal the full answer. A two-second scripted hold exposes the diagnostic phase only.
- AC10 chronological ordering checks the four new bubbles after the fixture baseline, and waits for durable completion before the second send.
- AC12 checks two new turns, then exact text equality after F5. Bounded assertions replace the fixed two-second hydration sleep.
- AC26 checks the actual PINEAPPLE prompt and last answer, not the initialization message; the same answer must survive F5. Its existing read-only API case is retained unchanged.

## Proof

System Node outside sandbox; serial worker; existing built artifacts. Command from `apps/e2e`:

`node scripts/run-playwright-with-stack.mjs ac-10-streaming-visible.spec.ts ac-12-reload-history.spec.ts ac-26-history-reload.spec.ts --project=chromium --workers=1 --reporter=line`

`KALIO_PLAYWRIGHT_SKIP_BUILD=1`; isolated UI/API `64857/64858`, storage `data/playwright-stack/1791120088574-43860/`. **5 passed (14.5s), exit 0**, 15:21:46. Four previously failed cases recovered; one already-passing API case remains green. Local root gate and full Chromium sweep were not rerun here. No new live Devin/Codex turn or deployment is claimed.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Partial/final streaming | PASS | Actual browser chunks plus durable exact final text | Real-provider acceptance separate |
| Chronological new turns | PASS | Baseline-relative interleaved user/agent order | None for this isolated case |
| History after F5 | PASS | Exact prior answer contents restored in AC12/AC26 | Broad suite still NO-GO |

QA257 retains the RED screenshots/traces. This is non-visual test preparation/assertion repair; fixed QA was not restarted.
