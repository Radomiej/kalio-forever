# QA run 11 — Devin SWE-2, build i pierwszy preview `home-site`

**Data:** 2026-09-27, Europe/Warsaw. **Werdykt bieżący:** `NO-GO` dla strony: build jest zielony, lecz aplikacja nie renderuje się w przeglądarce. Użytkownik zlecił przekazanie naprawy agentowi Playwright, ale nie znaleziono aktywnego agenta Playwright ani działającego MCP; nie wysłano jeszcze promptu do innego agenta.

## Środowisko i granice

- Checkout Kalio: `C:\Users\Radomiej\.codex\worktrees\5a7e\kalio-forever`, detached `HEAD c436ca4`; checkout był już zmodyfikowany, bez resetu/porządkowania cudzej pracy.
- Stały QA: UI `http://localhost:5288/`, API `http://127.0.0.1:3316/`, profil `qa`, dane `C:\Users\Radomiej\AppData\Local\kalio-forever-qa` (`kalio-qa.db`, `workspaces`). Odłączony ukryty supervisor PID 48092; backend PID 31152, frontend PID 29044. Efektywny provider Kalio `mock/mock`, source `env`.
- Cel: `E:\Projekty\home-site`, zachowana rozmowa `Devin SWE-2 QA`, model CLI `swe-2-high`. Nie przełączano Kalio na płatnego providera. Natywne narzędzia filesystem/web/terminal Devina pozostały wyłączone; użyto scoped Kalio MCP z ręcznym HITL dla `terminal_spawn`.
- Statyczna bramka `npm.cmd run agentflow:paid-readiness -- --static-only`: 4 blokery dla płatnych/live uruchomień (mock provider, source env, brak zapisanej i aktywnej referencji). Wykonano jedną lokalną darmową próbę Devin ACP w ramach wyjątku QA; nie twierdzimy, że bramka płatna przeszła.
- Przeglądarka: Codex in-app browser, lokalne preview `http://127.0.0.1:4173/`, viewport `1280×720`. Brak produkcji i publicznego udostępnienia.

## Przebieg

1. Po poprzedniej turze `pnpm qa:status` wykazał `partial/stale`; 3316/5288 nie słuchały. `mcp-cli-agents` nadal działał na 3413/3414. Uruchomiono `start-qa.ps1` jako jeden ukryty, oddzielny proces z logami `.tmp/qa-run-11-launch.*.log`; API (638 plików, 0 błędów TS) i web (3104 moduły) zbudowały się. `qa:status` pokazał `running`, oba health `ok`, `mock/mock/env`.
2. Zidentyfikowano aktywną pętlę restartów **innej** usługi `mcp-playwright-orchestrator`: co kilka sekund `npm.cmd run dev:server` kończył się `TS2688: Cannot find type definition file for 'node'`; zadeklarowane `@types/node` nie istnieje w lokalnym `node_modules`. Licznik osiągnął 5719. Zatrzymano tylko tę konkretną usługę przez `managed_service_stop`; pozostała `stopped` z pustym drzewem procesów. Nie kasowano danych ani nie kończono innych procesów. `autostart=true` w rejestrze tej usługi nie został zmieniony.
3. W zachowanym czacie Kalio użytkownikowa kontynuacja uruchomiła jedną ograniczoną próbę darmowego Devina. Każdą kartę `terminal_spawn` rozwinięto i ręcznie sprawdzono dokładny `cwd`, `command`, `args` przed osobnym potwierdzeniem:

   | Krok | Dokładne polecenie w `E:\Projekty\home-site` | Wynik |
   | --- | --- | --- |
   | 1 | `npm install --include=dev` | exit 0; dodano 58 pakietów; npm zgłosił 2 podatności (1 średnia, 1 wysoka). Bez `npm audit fix`. |
   | 2 | `npm run build` | exit 0; Vite 5.4.21, 26 modułów, `dist/index.html`, CSS 9.47 kB, JS 151.78 kB. |
   | 3 | `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort` | lokalny proces running; `terminal_spawn` PID 45868 (`cmd.exe`), właściwy proces Vite nasłuchujący na `127.0.0.1:4173` PID 59220 (`node.exe`). |

4. Browser QA: tytuł `NEXORA — Nowoczesne rozwiązania IT`, lecz widok jest pustym ciemnym ekranem, `#root` ma pustą zawartość i drzewo dostępności nie ma treści strony. Konsola dwukrotnie zgłosiła `ReferenceError: React is not defined` w wygenerowanym `assets/index-sq9f6blC.js`. Odczyt źródła potwierdził, że `src/App.jsx` importuje `useState, useEffect` bez domyślnego `React`; projekt nie ma `vite.config.js`. To mocny trop przyczyny, ale nie wprowadzano ręcznej poprawki w projekcie.

## Weryfikacja po restarcie i Chrome MCP

- Kalio UI `http://localhost:5288/` i API `http://127.0.0.1:3316/` odpowiadają. Read-only `GET /api/llm/config` potwierdził `provider=mock`, `model=mock`, `source=env`; provider nie był zmieniany.
- W Chrome MCP ponownie otwarto `http://127.0.0.1:4173/`: tytuł nadal wynosi `NEXORA — Nowoczesne rozwiązania IT`, ale drzewo dostępności zawiera tylko pusty `AXWebArea`, a zrzut ekranu pokazuje pusty ciemny ekran. Nie było możliwe wykonanie interakcji strony, bo nie renderuje żadnych kontrolek.
- Po restarcie komputera `mcp-playwright-orchestrator` automatycznie wystartował i ponownie uruchomił pętlę build/restart: `npm run dev:server` → `npm run build` → `tsc -p tsconfig.json` → `TS2688: Cannot find type definition file for 'node'` → exit code 2. Log z 01:12:00–01:12:19 pokazuje ponawiane starty co ok. 2 sekundy. Stan końcowy: `stopped`, puste drzewo procesów, `restartCount=5719`, `autostart=true`, `restartOnExit=true`; usługi nie restartowano ręcznie.
- Potwierdzenie źródła spamowania `cmd.exe`: autostart + `restartOnExit`/2-sekundowy delay w zarządzanej usłudze oraz deterministyczny błąd TypeScript przy każdym starcie. To błąd konfiguracji/runtime usługi Playwright, nie dowód błędu w stronie ani pojedynczego agenta generującego stronę.
- Kalio `Active agent runs` jest puste, a `Tools > MCP` pokazuje wyłącznie serwer `data-analyst`. W grupie Home Site istnieje ukończony chat `New Chat Devin SWE-2 QA`, lecz nie ma aktywnego chatu/persony Playwright. Nie wysłano jeszcze defektu do Devina, bo to inny agent niż wskazany przez użytkownika.
- Osobny chat Codex `Luna Max — Home Site QA root-cause review` zakończył read-only review. Potwierdził: bundle wywołuje `React.createElement`, `App.jsx` nie importuje domyślnego `React`, a import w `main.jsx` nie jest dostępny jako binding w innym module. Przyczyna renderowania jest potwierdzona; klasyczny transform JSX bez aktywnego pluginu Vite pozostaje hipotezą o wysokiej pewności.
- Zalecana minimalna poprawka przez Kalio UI/agent: dodać default import `React` do `src/App.jsx`, zachowując treść i wygląd; potem rebuild + preview. Regresja powinna potwierdzić widoczny nagłówek „Budujemy oprogramowanie”, 0 błędów `pageerror`, zmianę menu `aria-expanded=false → true`, oraz zrzut tej samej wersji `dist`. Luna nie edytowała plików ani nie uruchamiała testów/LLM/Devina.
- Powtórny screenshot jest widoczny w bieżącej sesji Chrome MCP, ale nie został zapisany jako nowy plik. Trwałe assety `01` i `02` pozostają z pierwszego wykonania run 11; `02` dokumentuje ten sam pusty stan.

## Zrzuty

- [01 — Kalio: wynik instalacji/builda/preview](assets/01-kalio-devin.png)
- [02 — lokalne preview: pusty ekran przy `React is not defined`](assets/02-home-site-blank.png)

## Macierz akceptacji

| AC / PIT | Status | Dowód | Następny krok |
| --- | --- | --- | --- |
| AC-01 / PIT-04 — stały profil QA | PASS | `qa:status` running, 3316/5288, mock/mock/env, AppData | Potwierdzić trwałość po zakończeniu tury |
| AC-02 — zatrzymanie pętli `cmd.exe` | FAIL po restarcie | `autostart=true`, `restartOnExit=true`, logi pokazują kolejne starty i exit 2 po `TS2688`; obecnie `stopped`, bez procesów | Nie restartować; naprawić zależności/usługę albo zmienić autostart po decyzji użytkownika |
| AC-03 — rzeczywisty Devin przez Kalio | PASS | ten sam czat `Devin SWE-2 QA`, `swe-2-high`, trzy osobno zatwierdzone `terminal_spawn` | Brak kolejnego wywołania bez świeżej zgody |
| AC-04 — zależności i build | PASS | instalacja i build exit 0, artefakty `dist/` | Npm zgłosił 2 nieprzejrzane podatności |
| AC-05 / PIT-05 — działający preview w browserze | FAIL | Powtórka Chrome MCP po restarcie: pusty `AXWebArea`/ekran; wcześniejsza konsola: `React is not defined`; screenshot 02 | Przekazać defekt do właściwego agenta, naprawić przez Kalio i powtórzyć build + Chrome QA |
| AC-06 / PIT-09 — mobile/keyboard/WCAG strony | BLOCKED | Strona nie renderuje się | Testować dopiero po naprawie runtime |
| AC-07 — produkcja | N/A | Test tylko lokalnego QA, provider Kalio mock | Wdrożenie nie było zlecone |

## Findings

| Priority | Finding or action | Impact | Evidence | Resolution |
| --- | --- | --- | --- | --- |
| P1 | Aplikacja React buduje się, lecz nie renderuje. | Strona firmy jest całkowicie bezużyteczna w preview. | Pusty `#root` i `ReferenceError: React is not defined`; pusty stan potwierdzony ponownie w Chrome MCP po restarcie. | Brak poprawki; wskazany agent Playwright jest niedostępny. Nie patchować `home-site` ręcznie; czeka na wybór właściwego agenta. |
| P1 | `mcp-playwright-orchestrator` ponownie uruchamiał się po restarcie komputera i kończył błędem. | Powtarzane procesy `npm`/`cmd.exe` i możliwe obciążenie komputera. | `autostart=true`, `restartOnExit=true`, delay 2 s, `TS2688`, exit 2, `restartCount=5719`; stan końcowy `stopped`. | Nie restartować. Przed kolejnym rebootem naprawić zależność brakującą `@types/node` albo po zgodzie wyłączyć autostart/watchdog i zweryfikować pojedynczy start. |
| P2 | `npm install --include=dev` zgłosił 2 podatności. | Ryzyko zależy od dotkniętych pakietów i drogi użycia. | Wynik npm: 1 średnia, 1 wysoka; bez audytu szczegółów. | Osobna, read-only triage przed produkcją; nie uruchamiać automatycznej naprawy bez decyzji. |

Nie wykonano dodatkowych poleceń w `home-site`, `npm audit fix`, zmian źródłowych ręcznie, wdrożenia ani testu mobile po pustym renderze.
