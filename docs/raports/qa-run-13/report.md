# QA run 13 — Kalio stable QA, Devin SWE-2 i Home Site

**Data:** 2026-09-27 (Europe/Warsaw)  
**Werdykt:** `CONDITIONAL` dla lokalnego QA. UI Kalio, host Devin ACP, ograniczone narzędzia Kalio i desktopowy preview Home Site działają. Nie naprawiono źródłowego builda Playwright Orchestratora ani nie udostępniono jego MCP personie Devin.

## Środowisko i granice

- Kalio stable QA UI: `http://localhost:5288/`; ekran Talk załadował się w Chrome MCP.
- Kalio API jest skonfigurowane na `127.0.0.1:3316`. Bezpośrednia karta Chrome dla `/api/health` zwróciła `ERR_BLOCKED_BY_CLIENT`; to ogranicza dowód z tej przeglądarki i samo w sobie nie dowodzi awarii API.
- Home Site: wyłącznie lokalny preview `http://127.0.0.1:4173/`, projekt `E:/Projekty/home-site`; bez użycia hostowego filesystemu/terminala do tego projektu.
- Devin CLI host: wersja `3000.11.1`, Online, zalogowany, ACP available, 634 modele wykryte; aktywny host `swe-2-high`. Status darmowego limitu nie był niezależnie weryfikowany.
- Ustawienia Kalio: domyślny provider pozostaje `mock`; sesja QA jest oznaczona `Devin CLI · swe-2-high`.
- Nie wykonywano zmian źródeł, instalacji, nowego builda Home Site ani deployu.

## Macierz akceptacji

| AC | Status | Dowód | Granica / pozostała praca |
|---|---|---|---|
| AC-01 — UI stable QA po restarcie | PASS | Chrome otworzył `http://localhost:5288/`; widoczny chat i ustawienia. | API health nie było dostępne bezpośrednio w Chrome (`ERR_BLOCKED_BY_CLIENT`); same operacje narzędzi Kalio zakończyły się poprawnie. |
| AC-02 — Devin SWE-2 ACP host | PASS | Integrations UI: Devin CLI `3000.11.1`, Online, ACP available, 634 modeli; `swe-2-high` aktywny. | Nie potwierdzano rozliczenia/free tier. |
| AC-03 — Devin widzi allowlistę narzędzi Kalio, a native tools są zablokowane | PASS | Persona `Devin SWE-2 QA`: 6/59 tools, MCP `allow_list`; `fs_read`, `fs_list`, `fs_write` (HITL), `terminal_spawn` (HITL), `terminal_list`, `terminal_output`. Integrations: native Devin Filesystem/Web/Terminal = `0`; Codex profile MCP blocked. | To dowodzi ustawień Kalio oraz wywołanych narzędzi, nie szerszych funkcji samego klienta Devin poza tym interfejsem. |
| AC-04 — Kalio `fs_read → fs_write → fs_read` z HITL | PASS | W personie `Devin CLI · swe-2-high` odczytano `E:/Projekty/home-site/package.json` (21 linii, 415 B); zatwierdzono osobny HITL dla zapisu do dokładnie tej ścieżki; `bytesWritten=415`; ponowny odczyt wykazał identyczną treść i rozmiar. | To był no-op; nie testowano odmowy HITL ani terminala w tym runie. |
| AC-05 — strona Home Site w Chrome | PASS dla desktopowego localhost | Drzewo dostępności zawiera nawigację, hero, usługi, realizacje, opinię, kontakt i stopkę. Kliknięcie „Usługi” zmieniło hash na `#uslugi`; formularz pokazał status sukcesu. Odczyt `onSubmit` potwierdził `preventDefault()` + stan lokalny, bez fetch/XHR/action — dane nie były wysyłane. | Nie testowano mobile viewport, pełnej klawiatury ani audytu WCAG. Build nie był ponawiany w run 13; wcześniejszy run 12 raportuje build Vite PASS po poprawce importu React. |
| AC-06 — Playwright Orchestrator MCP w Kalio globalnie | PASS dla konfiguracji/runtime | Kalio Tools pokazuje `playwright-orchestrator` z 26 tools pod `http://127.0.0.1:3333/mcp`; managed service `running`, PID `61072`, port `3333`; log końcowy z 11:28:32Z mówi `listening`. | Bezpośrednia karta Chrome do `3333/health` zwróciła `ERR_BLOCKED_BY_CLIENT`; nie wywołano narzędzia Playwright MCP w tej próbie. |
| AC-07 — Playwright tools przypisane Devin | BLOCKED / celowo nieprzypisane | Persona Devin ma `MCP allow_list` i panel „No MCP servers connected”. | Nie przydzielono 26 narzędzi: nie potwierdzono egzekwowania allowlisty originów ani własności sesji. |
| AC-08 — naprawa builda źródłowego Playwright | BLOCKED | Bieżąca usługa działa z wyłączonym watchdogiem; logi historyczne zawierają `TS2688: Cannot find type definition file for 'node'`, a runtime raportuje `restartCount=427`. | Agent naprawczy nie ma checkoutu `E:\Projekty\mcp-playwrigh-master`; źródła nie zostały zmienione ani przebudowane. |
| AC-09 — screenshot PNG w katalogu raportu | PARTIAL | Screenshot Chrome z sekcją kontaktową i statusem formularza został wyrenderowany jako obraz w obserwacji CUA/MCP w tej rozmowie. | API screenshotu użytego adaptera zwraca obraz w rozmowie, ale nie udostępniło ścieżki/eksportu pliku; dlatego w tym folderze nie deklaruję ani nie linkuję PNG. |

## CMD spam / restart loop

Dowody wskazują na watchdog managed service, a nie na wiele celowych wywołań terminala przez Devin:

1. Stary proces uruchamiał `npm.cmd run dev:server` → `npm run dev` → `npm run build && node ...` — kilka warstw npm/`cmd.exe` tworzyło kilka procesów potomnych przy każdym starcie.
2. `tsc -p tsconfig.json` kończył się `TS2688` (brak definicji typów `node`); watchdog planował restart po 2 sekundach. Błąd ma 6 601 historycznych trafień w logach, a usługa wykazuje 427 restartów w tym runtime.
3. Teraz `restartOnExit=false`; tail logu kończy się wpisem `listening` z 11:28:32Z i nie ma późniejszych wpisów w odczytanym ogonie. Nie ma dowodu, że pętla trwa obecnie.

Prawdopodobny mechanizm „dziesiątek CMD” to powtarzany start wadliwego skryptu przez watchdog plus zagnieżdżone skrypty npm. `@types/node`/lockfile/katalog instalacji to hipotezy do sprawdzenia w repo Orchestratora, nie potwierdzona przyczyna.

## Integracje i delegacje

- W Kalio globalnie skonfigurowane są 2 serwery MCP / 26 tools: Playwright Orchestrator (26) oraz Data Analyst. Data Analyst zwraca `fetch failed` na `127.0.0.1:3000/mcp`.
- Luna Max (`gpt-6-luna`, reasoning `max`) zakończyła przegląd: nie przydzielać teraz Playwright MCP Devinowi. Dowolna nawigacja URL i wznowienie sesji bez dowodu własności mogą przekroczyć zakres projektu lub udostępnić cudzą sesję; przed przydziałem wymagane są origin allowlist i kontrola własności sesji.
- Informację o TS2688/restart loop wysłano do wcześniejszego agenta badającego Playwright. Odpowiedź: brak checkoutu/artefaktów repo Orchestratora i brak osobnego wątku agenta Playwright; nie wykonał zmian. Zasugerował sprawdzenie `package.json`, `tsconfig.json` i lockfile, a następnie `npm ci` + `npm run build` w repo Orchestratora.

## Findings

| Priority | Finding | Impact | Evidence | Resolution |
|---|---|---|---|---|
| P2 | Źródłowy build Playwright nie ma świeżego PASS; historia `TS2688` doprowadziła do 427 restartów. | Nie można uznać usługi za samonaprawialną; watchdog jest wyłączony jako containment. | Log tail: błąd kompilacji i późniejszy start/listening; health inventory `running`, `restartOnExit=false`. | Agent nie ma zewnętrznego checkoutu. Naprawa wymaga dostępu do repo Playwright, weryfikacji zależności/lockfile i czystego builda przed przywróceniem watchdog. |
| P2 | Pełny Playwright MCP nie jest przypisany Devinowi. | Devin nie może automatyzować Chrome przez ten serwer. | Persona ma pustą listę MCP; Luna Max odradza szeroki grant bez origin/session guards. | Pozostawić tak do wdrożenia i testów izolacji originów oraz sesji. |
| P2 | Wymagany screenshot PNG nie został zapisany do folderu raportu. | Raport nie spełnia w pełni wymogu artefaktu screenshotów. | CUA zwróciło obraz w rozmowie, bez eksportowalnej ścieżki pliku. | W kolejnym podejściu użyć jawnie dostępnego eksportu screenshotu do katalogu raportu; nie podszywać starszego PNG pod ten run. |
| P3 | Data Analyst MCP jest niedostępny. | Pozostałe narzędzie MCP nie działa w tej konfiguracji. | Kalio Tools: `127.0.0.1:3000/mcp fetch failed`. | Osobna diagnostyka; nie blokuje potwierdzonego przepływu Devin → Kalio `fs_*`. |
| P3 | Chrome blokuje bezpośrednie health URL-e portów 3316 i 3333. | Nie uzyskano niezależnego widoku health JSON w Chrome. | `ERR_BLOCKED_BY_CLIENT` w obu kartach. | Traktować jako ograniczenie klienta Chrome; brak dowodu na awarię usług. |

## Granice dowodu

Potwierdzono lokalny desktop preview i przepływ Kalio/Devin dla list/read/no-op write z HITL. Nie potwierdzono mobile, keyboard-only, WCAG, bezpośredniego API health w Chrome, użycia Playwright tools przez Devin, builda Orchestratora ani produkcji.
