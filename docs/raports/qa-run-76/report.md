# QA76 — izolacja runtime-config i korekta diagnozy

2026-10-03, checkout `C:\Users\Radomiej\.codex\worktrees\5a7e\kalio-forever`, branch `codex/kalio-provider-runtime-ux`, baza3419083. Wcześniejsze zmiany zachowane. System Node poza sandboxem. Stałe QA API3316/UI5288/AppData bez restartu, projektu Home Site nie zmieniano.

## Przyczyna i minimalna naprawa

Izolowany launcher zapisywał wspólny dist/runtime-config.js, chociaż Vite już serwuje tę trasę przez process-local runtime-config middleware z VITE_API_URL/VITE_WS_URL. Usunięto redundantny zapis i jego nieużywane importy/ścieżki. Nie wprowadzono save/restore, które nadal tworzyłoby konflikt równoległych launcherów. Nie tworzono nowego serwera ani warstwy konfiguracji.

QA75 udowodniło nadpisanie artefaktu, ale nie awarię HTTP3316/5288: middleware przesłania plik. Skorygowano P1 na P2 i dodano sprostowanie do historycznego raportu. Nie wyciągamy wniosków o awarii UI z samej zawartości pliku.

| AC | Status | Dowód | Granica |
|---|---|---|---|
| Shared runtime-config nie jest nadpisywany przez skip-build launcher | PASS | Test RED: plik3316 zmieniony na52634; po zmianie GREEN | Realny child launcher z fake pnpm/backend fixture |
| Cały zestaw launchera | PASS | Node test14/14,31.59s,exit0 | Nie pełny root gate |
| Rzeczywiste niezależne HTTP origins | PASS | Nowy qa-runtime-config-isolation.spec.ts, isolated55352/config→55353, fixed5288/config→3316, shared file→3316 | Read-only coexistence audit, bez interceptów |
| Home Site i completed chat na obecnym QA | PASS | Pozostałe trzy Chromium tests; razem4/4,7.8s,exit0 | HomeSite57868:320/390/1440, hero320, chat F5 320/390/820 |
| Stan po zakończeniu runnera | PASS | GET fixed runtime-config HTTP200→3316 i plik nadal3316 | Bez ręcznego recovery |

Uruchomienie: `node apps/e2e/scripts/run-playwright-with-stack.mjs qa-runtime-config-isolation.spec.ts qa-home-site-chat-live-audit.spec.ts home-site-live-audit.spec.ts --workers=1`, SKIP_BUILD1, fixedQA5288/report76, HomeSite57868/report76. Pomocniczy stack55353/55352 zakończony przez runner. Nie uruchamiano kolejnych promptów ani native tools Devina.

Screens: [chat390](assets/completed-real-chat-390.png), [HomeSite390](assets/home-site-390.png), [hero320](assets/home-site-hero-320.png); pełne capture320/390/820 dla chatu i320/390/1440 dla strony w assets.

Werdykt poprawki runtime-config przy skip-build coexistence: **PASS**. Pełna izolacja shared build artifacts w trybie build nie była tutaj dowodzona; nie twierdzimy, że wszystkie równoległe buildy są bezpieczne. Cały cel pozostaje **UNVERIFIED**: pozostała macierz UX/CTO, source ownership/commity, procesy i Playwright Orchestrator.
