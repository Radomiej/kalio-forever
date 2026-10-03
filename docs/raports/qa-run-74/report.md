# QA 74 — zamknięcie backend lint

2026-10-03. Checkout `C:\Users\Radomiej\.codex\worktrees\5a7e\kalio-forever`, branch `codex/kalio-provider-runtime-ux`, baza `e54b79f`. Pozostałe wcześniejsze zmiany zachowane; sześć poniższych plików miało przed tym etapem czysty diff. Bez nowych promptów, resetu QA, zmian tokenów i zmian w `E:\Projekty\home-site`.

| AC | Status | Dowód | Granica |
|---|---|---|---|
| API lint | PASS | `corepack pnpm run lint`, exit0 w jawnie fail-fast sekwencji | Pełne src API |
| API typecheck | PASS | `corepack pnpm run typecheck`, exit0 przed build | Aktualny worktree |
| API build | PASS | `corepack pnpm run build`, TSC0, SWC672, końcowy exit0 | Zbudowany dist, nie przełączony działający QA |
| Regresje dotkniętych adapterów/subagenta | PASS | 5 plików, 47/47, 4.67 s | Unit/mock; nie live Claude/Devin Cloud/VS Code |
| Pełny gate po tych zmianach | UNVERIFIED | Ostatni pełny gate QA73 sprzed tej poprawki | Nie przedstawiamy poprzedniego wyniku jako rerun |

## Zmiany odpowiadające dziesięciu błędom QA73

- Claude SDK: usunięto wyłącznie unused type imports SDKMessage/ExecutionProfile.
- Devin Cloud: usunięto unused ExecutionProfile i inicjalizację finalSession, zawsze zastępowaną pierwszym udanym getSession; błąd getSession nadal rethrow, abort nadal return przed odczytem finalSession.
- Devin native tools: usunięto nieużywany prywatny escapeRegExp.
- Subagent: usunięto unused SessionRuntimeContext; promptMessageId jest const po persistUserMessage. Utworzenie trackingEmit przesunięto po persist; helper jedynie tworzy closure, nie wysyła przy utworzeniu eventów. `agent:start` nadal następuje dopiero po zapisie. Regresje subagenta31 PASS.
- Managed VS Code process: zbędne escaping cudzysłowów w template literal usunięte; wynikowy skrypt pozostaje identyczny, windowsHide i ograniczenia ownership nietknięte.
- Project IDE runtime: zamiast przypisania do parametru catch używa lokalnej zmiennej failure, zachowując dotychczasową normalizację, redakcję i audit.

Tests: claude-agent-sdk.llm-source.spec.ts (3), devin-api.llm-source.spec.ts (3), devin-native-tools.spec.ts (6), project-ide-runtime.manager.spec.ts (4), subagent-runtime.service.spec.ts (31). Test managera dotyczy adaptera query/diagnostics, nie realnego shutdown/timeout; nie deklarujemy nowej live proof tej gałęzi.

Weryfikacja na system Node22.15.0 poza sandboxem. Lint, typecheck i build uruchomione ponownie w sekwencji zatrzymującej się po każdym niezerowym kodzie. Nie uruchamiano zbiorczego autofix. Źródła przejrzano w diff; nie stage'owano pozostałych wcześniejszych zmian.

Werdykt lokalnego zakresu: **PASS**. Cały cel pozostaje **UNVERIFIED**: konieczne reviewed source/build parity na QA, pozostałe kryteria UX/CTO, ciągły pomiar CMD i osobna naprawa Playwright Orchestrator. Web warnings24 z QA73 pozostają jawne; nie są zamknięte tym etapem.
