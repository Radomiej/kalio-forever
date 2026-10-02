# QA Run 17 — Chrome smoke, stable QA, Playwright handoff

- Data: 2026-09-27 (odczyty ok. 16:03 UTC; PNG captured 16:07 UTC)
- Checkout Kalio: `C:\Users\Radomiej\.codex\worktrees\5a7e\kalio-forever`
- Stan checkoutu: `git status` na początku pokazywał liczne wcześniejsze zmiany/untracked pliki w repo; pozostawiono je. Ten run dodał wyłącznie `docs/raports/qa-run-17/`.
- QA UI/API: `http://localhost:5288/` / `http://127.0.0.1:3316/api/health`
- QA data root: stały QA profile; ścieżki AppData nie odczytano ponownie w tym runie.
- Strona Home Site: `http://127.0.0.1:4173/` (preview fikcyjnej firmy NEXORA)
- Przeglądarka testowa: Chrome przez zintegrowany browser bridge (`cua_repl`), bez wymuszonego rozmiaru viewportu. Osobny Chromium Playwright Orchestrator (viewport 1440×900) użyto wyłącznie do utrwalenia pełnostronicowego PNG; interakcje/werdykt smoke pochodzą z Chrome.
- Zakres: punktowe sprawdzenie QA, ustawień MCP/Devin oraz Home Site po restarcie. Konsoli i ruchu sieciowego nie zbierano.
- Nie wysłano nowego promptu do Devin ACP, nie wykonano submitu formularza, nie zmieniano konfiguracji usług ani plików `home-site`.

## Wynik

| Obszar | Status | Dowód | Pozostało |
|---|---|---|---|
| Stabilny QA | PASS (punktowo) | UI `:5288` HTTP 200 (634 B); API `:3316/api/health` HTTP 200, `{"status":"ok"}`. | Pełny flow Devin nie był uruchamiany w tym przebiegu. |
| Efektywny provider Kalio | PASS | Settings → LLM Settings: `mock`, model `mock`, environment fallback. | To nie jest dowód kosztu ani providera samego Devin CLI. |
| Devin runtime | PASS po ręcznym Recheck | UI po Recheck pokazało `devin.exe` Online, logged in, ACP available, 634 modele; istniejący czat wskazuje `Devin CLI · swe-2-high`. | Brak nowego ACP/tool run w QA run 17. |
| Natywne Devin tools | PASS (wyłączone) | Settings → Integrations: Filesystem, Web i Terminal miały `Value: 0`; bridge Kalio oznaczony enabled. | Nie zmieniano allow-listy ani tokena. |
| MCP w Kalio | PARTIAL | Settings → MCP Servers: `Connected 1/2`, `playwright-orchestrator` connected, 26 tools; `data-analyst` zgłasza `fetch failed`. | Zdiagnozować Data Analyst osobno; nie restartowano serwerów. |
| Home Site: render/nawigacja | PASS (desktop smoke) | Świeża karta Chrome pokazuje tytuł NEXORA, główny nagłówek i sekcje; klik „Kontakt” zmienił URL na `#kontakt` i pokazał formularz. | Konsola JS, małe viewporty i pełne testy dostępności nie były dostępne w tym Chrome bridge. |
| Home Site: formularz | PASS (bez wysyłki) | Pola przyjęły syntetyczne wartości, potem zostały wyczyszczone; nie klikano „Wyślij wiadomość”. | Nie testowano submitu. |
| Stary stan potwierdzenia formularza | N/A / nie reprodukuje się świeżo | Istniejąca karta `#kontakt` pokazywała „Dziękujemy”; nowa karta pod `/` pokazała formularz. To stan starej karty po wcześniejszym lokalnym teście, nie błąd na świeżym wejściu. | Brak potwierdzonej usterki do przekazania Devinowi. |
| Test granicy Playwright MCP | BLOCKED | Agent Sartre potwierdził brak testu handlera MCP w `tests/mcpServer.test.ts`, ale checkout `E:\Projekty\mcp-playwrigh-master` jest poza writable roots tego zadania. Niczego nie zmienił ani nie uruchomił. | Potrzebny dostęp zapisu do dokładnego repo; proponowany test: `browser_session_create` przekazuje żądane `headless=true` do managera i zachowuje w odpowiedzi efektywne `headless=false`. |
| Playwright restart count | UNRESOLVED | Usługa `mcp-playwright-orchestrator` działa na `:3333`, `autostart=true`, `restartOnExit=false`, `restartCount=427`. `forceVisibleBrowsers=true` wyjaśnia efektywne `headless=false`; to nie jest błąd. | Historyczny licznik nie wyjaśnia restartów; nie zmieniano polityki ani procesu. |
| Dev stack / restarty | UNRESOLVED | Bieżący inventory: `kalio-forever` dev na `3016/5188`, `autostart=false`, `restartOnExit=true`, `restartCount=20` (run 16 widział 15). | Przyczyna wzrostu o 5 nieustalona; w tym runie nie prowokowano awarii ani nie ubijano procesów. |
| Luna Max | IN PROGRESS | Utworzono osobny, doradczy wątek `gpt-6-luna` z reasoning `max`, ID `01a0e395-1d99-79b0-91d7-0c33232026bd`; bez uprawnień do edycji/uruchamiania Devina. | Czeka na opinię. |

## Obrazy i ograniczenia

![Pełna strona NEXORA — zrzut Chromium Playwright Orchestrator, 1440×900 viewport](assets/01-home-site-fullpage.png)

Plik PNG (1425×3972) zapisano z osobnej sesji Chromium Playwright Orchestrator na `http://127.0.0.1:4173/`; sesję zamknięto po przechwyceniu. Chrome bridge pokazał też ekran Settings → MCP Servers bezpośrednio w wynikach narzędzia, ale nie udostępnił eksportu tego drugiego zrzutu do pliku.

## Priorytety

- [P2] Dodać i uruchomić test granicy MCP Playwright po udostępnieniu checkoutu `E:\Projekty\mcp-playwrigh-master` jako writable.
- [P2] Ustalić przyczynę wzrostu `kalio-forever.restartCount` 15 → 20 z istniejących logów, bez restartowania/ubijania procesów.
- [P2] Wyjaśnić `data-analyst: fetch failed` w QA albo świadomie wyłączyć integrację w profilu QA.
- [P3] Jeśli wymagana jest trwała evidencja ekranu MCP z błędem `data-analyst`, zapisać ją jako osobny asset; obecny Chrome bridge tylko wyświetlił ten zrzut, a repo zawiera pełnostronicowy asset Home Site.

## Granice dowodu

To był smoke w działającej przeglądarce Chrome, nie pełny regression/production gate. Nie wykonano nowego wywołania SWE-2, nie testowano mobile, konsoli ani wysłania formularza. Nie potwierdzono głównego HITL przepływu w tej sesji. Run 17 nie zamyka celu wygenerowania i zweryfikowania strony przez świeże wywołanie agenta.
