# QA run 9 — restart po reboocie i build przez Devin SWE-2

**Data:** 2026-09-26, Europe/Warsaw  
**Werdykt:** `CONDITIONAL` — stały QA i lokalny Devin działają. `npm install` zakończył się kodem 0, ale pominął `devDependencies`; `npm run build` zakończył się kodem 1. Strony nie uruchomiono w preview.  
**Zakres:** uruchomienie `mcp-cli-agents` i stabilnego QA, odtworzenie rozmowy Devin w UI Kalio, ręczna akceptacja dokładnie dwóch poleceń w `E:\Projekty\home-site`. Bez zmian źródeł strony, dodatkowych komend, preview, wdrożenia ani produkcji.

## Środowisko

- Checkout Kalio: `C:\Users\Radomiej\.codex\worktrees\5a7e\kalio-forever`, `HEAD c436ca4`, detached. Checkout był już mocno zmodyfikowany przed runem; istniejących zmian nie resetowano ani nie porządkowano. Dodano tylko ten raport i dwa screenshoty.
- Stabilny QA: UI `http://localhost:5288/`, API `http://127.0.0.1:3316/`; profil `qa`; data root `C:\Users\Radomiej\AppData\Local\kalio-forever-qa`; baza `kalio-qa.db`, workspace `workspaces`.
- Efektywny provider Kalio: `mock/mock`, source `env`; API `/api/health` zwróciło `ok`, `/api/llm/config` potwierdziło `mock/mock/env`. To nie określa modelu Devin CLI.
- Serwer agentów `mcp-cli-agents`: uruchomiony, REST `3414`, MCP `3413`, UI `5534`; health `ok`, `activeTurns=0`, **autostart=false**. Nie uruchamiano osobnego dev-stacku Kalio na `3016/5188`.
- Host Devin: Settings → Integrations pokazało `devin.exe` online, zalogowany, ACP dostępne, 634 odkryte modele. Rozmowa używała persony `Devin SWE-2 QA` i modelu CLI `swe-2-high`.
- Przeglądarka: CUA w in-app browser do ręcznej obsługi; screenshoty raportu zapisano z Playwright, Chromium headless, viewport `1280×720`. Błędy `console`/`pageerror` w przechwyconych stronach: 0.
- Cel: istniejący projekt `Home Site`, dokładna ścieżka `E:\Projekty\home-site`.

## Przebieg i wyniki

1. `pnpm qa` (przez `start-qa.ps1`) wykrył nieaktywne, nieistniejące już PID-y zapisane w stanie QA; żaden z portów QA nie nasłuchiwał. Backend i frontend przebudowano, a stack uruchomił się na stałych portach. Backend skompilował 638 plików, frontend przetworzył 3104 moduły. Jest ostrzeżenie Vite o chunku ok. 2,1 MB, ale build Kalio zakończył się sukcesem.
2. `/api/health`, runtime config frontendu, Socket.IO polling handshake i `pnpm qa:status` potwierdziły działające API/UI, zgodne PID-y i `mock/mock`.
3. Otwarta przed startem karta nie odtworzyła od razu listy: Talk pokazał `0 chats`, a picker tylko `Default`. Po ręcznym odświeżeniu odtworzyły się rozmowy i projekt; lista miała 7 chatów, a wcześniejsza rozmowa Devin nadal zawierała projekt `Home Site`. Rozmowa nie została utracona.
4. W odtworzonej rozmowie Devin przez UI najpierw potwierdził `package.json` i projekt, bez zmian źródeł. Przekazano mu świeże, ograniczone polecenie wynikające z późniejszej zgody użytkownika.
5. `terminal_spawn`: `cwd=E:\Projekty\home-site`, `command=npm`, `args=["install"]`. Żądanie sprawdzono i ręcznie zaakceptowano. Devin zgłosił kod `0`, 5 pakietów, 0 podatności, ok. 20 s. Późniejsza kontrola w obrębie projektu pokazała brak `vite` i `@vitejs/plugin-react` w instalacji.
6. `terminal_spawn`: `cwd=E:\Projekty\home-site`, `command=npm`, `args=["run","build"]`. Żądanie sprawdzono i ręcznie zaakceptowano. Wynik: kod `1`, `vite is not recognized as an internal or external command`.
7. Po nieudanym buildzie nie uruchomiono żadnej kolejnej komendy, nie zmieniano plików źródłowych i nie uruchamiano preview. Sugestia Devina, że przyczyną jest `NODE_ENV=production`, pozostała hipotezą — nie wykonano diagnostyki środowiska ani konfiguracji npm, bo wykraczałaby poza zatwierdzone polecenia.

Screenshoty:

- [01 — stabilny QA, Talk i zachowane projekty/rozmowy](assets/01-qa-talk.png)
- [02 — rozmowa Devin, wynik instalacji i błąd builda](assets/02-devin-chat.png)

## Macierz akceptacji

| Kryterium | Status | Dowód / granica |
|---|---|---|
| Stabilny QA po restarcie | PASS | UI `5288`, API `3316`; `qa:status` running, oba health `ok`, dane w AppData. |
| Provider QA nie przeszedł niejawnie na live | PASS | `/api/llm/config`: `mock/mock`, source `env`. |
| Agent control plane uruchomiony bez autostartu | PASS | `mcp-cli-agents` health `ok`, porty `3413/3414/5534`, `autostart=false`. |
| Rozmowy/projekt zachowane po odświeżeniu | PASS | UI pokazał 7 rozmów i `Home Site`; wcześniejszy chat Devin zachowany. |
| Stan FE po backendowym restarcie odświeżył się sam | FAIL | Otwarta karta najpierw pokazała `0 chats`; ręczny reload przywrócił dane. |
| Rzeczywisty Devin CLI przez Kalio UI | PASS | `devin.exe` online/ACP; chat `Devin SWE-2 QA`, `swe-2-high`; żądania terminalne widoczne w Talk. |
| Dokładne `npm install` w zatwierdzonym cwd | PASS z zastrzeżeniem | Kod `0`, ale zainstalowano tylko pakiety produkcyjne; brakuje wymaganych devDependencies. |
| `npm run build` | FAIL | Kod `1`: brak wykonywalnego `vite`. |
| Przyczyna pominięcia devDependencies ustalona | BLOCKED | `NODE_ENV=production`/npm omit niezweryfikowane; dodatkowa komenda nie była zatwierdzona. |
| Wizualny preview wygenerowanej strony | BLOCKED | Build nie przeszedł; `npm run preview` nie było zatwierdzone. |
| Produkcja | NOT RUN | Lokalny QA, provider mock; brak wdrożenia. |

## Findings

| Priority | Finding or action | Impact | Evidence | Resolution |
|---|---|---|---|---|
| P2 | Otwarte FE nie odtworzyło rozmów po powrocie API; wymagany był reload. | Użytkownik po restarcie nie widzi od razu zachowanych czatów/person. | Przed reloadem Talk: `0 chats`; po reloadzie: 7 rozmów i `Home Site`. | Zbadać retry/hydration po reconnect w osobnym, zatwierdzonym przebiegu. |
| P2 | Instalacja pominęła Vite i plugin React, więc build strony nie działa. | Nie ma dowodu, że wygenerowana strona się buduje ani działa wizualnie. | `npm install` kod `0`; potem `npm run build` kod `1`, brak `vite`. | Potrzebna zgoda na read-only diagnozę `NODE_ENV`/npm omit oraz `npm install --include=dev` i ponowny build w tym samym cwd. Preview wymaga osobnej zgody na `npm run preview`. |

## Granice dowodu

- Nie czytano ani nie edytowano ręcznie plików `home-site`; sprawdzenie projektu i wyniki operacji pochodzą z rozmowy/tool flow Kalio.
- Hipoteza `NODE_ENV=production` nie jest potwierdzona.
- Zrzuty pokazują UI Kalio i wynik narzędzi; nie ma screenshotu wygenerowanej strony, bo build się nie powiódł.
- Podczas diagnozy powstał jeden pusty chat QA `New Chat` z personą `Default`; pozostawiono go bez kasowania.
- QA pozostawiono uruchomione po teście; nie commitowano zmian.
