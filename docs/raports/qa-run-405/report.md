# QA405 — generated Home Site at 390 and 1440 px

2026-10-04. Actual existing built preview http://127.0.0.1:57868/, title NEXORA — Nowoczesne rozwiązania IT. IAB tab 4; worktree 5a7e source baseline 6af8789b plus unrelated dirty changes. No live LLM call, project edits, build, terminal launch, provider change or QA restart.

## Evidence audit

Initial read of qa-run-368/report.md failed because its actual artifact is README.md; bounded rg discovery located it. QA368 README documents manually approved CSS write and npm run build through Devin/Kalio, exit 0, Vite 5.4.21, 26 modules, 441 ms, then rendered CSS update and sampled primary contrast 5.41:1. This is historical evidence, not a build repeated today. QA392 supplies prior form/demo/retry and mobile keyboard checks. Neither report proves the full automatic Jev loop.

## Fresh browser checks

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Layout at requested 390 px | PASS scoped check | 390×844 viewport, document scrollWidth 375; one h1/main; no broken local hash targets | Full visual/accessibility conformance not asserted |
| Mobile menu pointer open/close | PASS | Open focuses Usługi; Zamknij menu closes and focus returns to Otwórz menu | Link navigation and keyboard covered previously, not repeated here |
| Layout at requested 1440 px | PASS scoped check | 1440×900 viewport, document scrollWidth 1425; one h1/main, desktop nav exposed | Hover/reduced-motion still separate |
| Console health | PASS observed buffer | error/warn logs empty | Network traffic not captured |

Screenshots [390 px](assets/home-390.png), [1440 px](assets/home-1440.png). Captures preserve the existing mid-page scroll position; they are not top-of-page/hero proof. Mobile screenshot visually inspected: portfolio heading/card remain inside viewport; fixed nav remains visible. Temporary viewport override reset afterwards. Existing Home Site tab retained as deliverable; QA tab retained for continuation.

No code change or deployment. Communication proof remains QA403; QA404 is the last frontend-only fixed-QA update. Overall goal remains active: short console attribution, Jev goal-loop integration and remaining interaction/accessibility/release gates are not closed by responsive snapshots. No external Linear/Notion sync.
