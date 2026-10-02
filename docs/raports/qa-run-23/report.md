# QA run 23 — stałe QA i Devin SWE-2 po restarcie

**Data:** 2026-09-28 (Europe/Warsaw)  
**Werdykt:** PASS dla dostępności Devina i pojedynczego wywołania Kalio MCP; brak powtarzających się uruchomień Devina podczas odświeżania statusu. **Uwaga P4:** pojedyncze uruchomienie Devina startuje również skonfigurowany przez niego Context7 MCP, co tworzy dwa procesy `cmd.exe`.

## Środowisko

- Stałe QA uruchomione z bieżącego checkoutu: UI `http://localhost:5288/`, API `http://localhost:3316/`.
- Dane QA pozostają w `%LOCALAPPDATA%\kalio-forever-qa` (baza `kalio-qa.db`, workspace `workspaces`); build i runtime to QA, nie produkcja.
- Ogólny provider LLM zwraca `mock/mock` (`source=env`). Devin został przetestowany osobno przez rzeczywisty lokalny ACP, nie przez mock.
- Worktree zawierał istniejące zmiany użytkownika. Nie resetowałem ani nie czyściłem checkoutu; w tym przebiegu nie edytowałem kodu aplikacji.

## Macierz akceptacji

| Obszar | Status | Dowód | Granica |
|---|---|---|---|
| Build i start stałego QA | PASS | `nest build`: 650 plików, 0 problemów; frontend Vite zbudowany. Stack manager: API/UI `running`, właściwy katalog AppData. | Vite zgłosił informacyjne ostrzeżenie o chunku >500 kB. |
| Health i konfiguracja | PASS | `/api/health`=`ok`; `/api/llm/config`=`mock/mock`, `source=env`; porty 3316 i 5288 nasłuchują. UI zwrócił HTTP 200. | Nie wykonywano zwykłego promptu na providerze mock. |
| Devin discovery i katalog | PASS | Po jednym `Recheck`: `Online`, `Logged in`, `ACP available`, `634 discovered`; lista zawiera m.in. `swe-2`, `swe-2-high`, `swe-2-medium`, `swe-2-max`. | Sam status/katalog nie dowodziłby wykonania narzędzia; wykonano niżej osobny canary. |
| Devin przez Kalio UI i bridge | PASS | Nowa rozmowa `QA Canary Restarcie QA`, persona `Devin SWE-2 QA`, runtime UI `Devin CLI · swe-2-medium`; dokładnie jedno `fs_list` dla `E:/Projekty/home-site/src`. Odpowiedź: 3 pliki (`App.jsx` 10 919 B, `main.jsx` 237 B, `styles.css` 11 700 B), `omitted=0`. | Tylko odczyt listy. Bez zapisu, terminala, web/native Devin tools i bez modyfikacji projektu. |
| UI runtime | PASS | Playwright runtime collector: 0 findings, 0 console errors/page errors/failed requests; odświeżenia statusu zwróciły HTTP 200. | Pełny test:e2e nie był uruchamiany. |
| CMD/Devin churn | PASS z uwagą P4 | Panel/UI pobierał status mniej więcej co 30 s (telemetria 10:42–10:48); nie uruchamiał kolejnych `devin.exe`. Przed canary 10:45:36: 74 `cmd.exe`, 14 `devin.exe`; po canary 10:46:21: 76/15; o 10:50:15: 74/15. | Jedno uruchomienie Devina utworzyło dwa `cmd.exe` dla `@upstash/context7-mcp` → `context7-mcp`. W tym samym oknie wykryto też krótkie CMD-y z rodzicami `codex.exe`, `pwsh.exe` i `node.exe`; nie przypisuję ich wszystkich Kalio ani Devinowi. |

## Ustalenie dotyczące CMD

W drzewie uruchomionym przez canary proces Devina (`devin.exe`, rodzic `node.exe`) utworzył `cmd.exe` z `npx.cmd -y @upstash/context7-mcp`; proces Node uruchomił następnie `context7-mcp`. To wygląda na MCP skonfigurowany w lokalnym środowisku Devina i startowany przy sesji, nie na cykliczny probe Kalio. Natywne przełączniki Devin filesystem/web/terminal w QA pozostały wyłączone; Kalio `fs_list` działał przez bridge.

W całym pomiarze 10:45:36–10:50:15 pojawiło się 8 nowych procesów `cmd.exe`, ale liczba żywych spadła z 74 do 74. Dwa są bezpośrednio w drzewie Devin/Context7; pozostałe miały rodziców PowerShell/Node/Codex. Dodatkowa para Context7 miała rodzica `codex.exe`, więc nie stanowi dowodu na powtórne uruchamianie Devina przez Kalio. Nie ubijałem żadnych procesów i nie sprawdzałem pełnych linii poleceń zawierających potencjalne sekrety, poza ograniczonym odczytem/redakcją potrzebnym do identyfikacji obu łańcuchów Context7.

**Wniosek:** nie odtworzyło się zapętlenie statusu tworzące kolejne procesy Devina. Nadal istnieje pojedynczy, obserwowalny koszt startu zewnętrznego Context7 przy realnej sesji Devina; jeśli oczekiwaniem jest zero nowych CMD także przy starcie agenta, trzeba osobno sprawdzić/ograniczyć MCP w profilu Devina. W tej rundzie nie zmieniałem jego globalnej konfiguracji.

## Zrzuty ekranu

- [Devin online i wykryty katalog modeli](assets/devin-online-and-models.png)
- [Rzeczywisty canary `fs_list` z Devina przez Kalio](assets/devin-fs-list.png)

## Następne kroki

- **Recommended:** osobno zdecydować, czy Context7 ma pozostać w profilu Devina; nie wyłączałem go, bo jest konfiguracją globalną Devina, a nie QA.
- **Optional:** pełne `pnpm test:e2e` — ten przebieg zamyka wyłącznie stały QA, UI, discovery oraz read-only Devin ACP canary.
