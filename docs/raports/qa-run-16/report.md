# QA Run 16 — Kalio MCP, Playwright Orchestrator i most Devin

- Data: 2026-09-27 (dowody runtime z ok. 15:14–15:33 UTC)
- Checkout: `C:\Users\Radomiej\.codex\worktrees\5a7e\kalio-forever`
- Zakres: kontrola stabilnego UI/API QA, połączenia Playwright MCP, konfiguracji mostu Devin oraz bezpieczne rozpoznanie restartów lokalnego dev stacka.
- Bez zmian w aplikacji i bez nowego promptu do Devin ACP. Nie generowano ani nie modyfikowano strony w `E:\Projekty\home-site` w tym przebiegu.
- Dane QA: użyto uruchomionego profilu QA na stałych portach; bieżący UI pokazywał ustawienie LLM `mock/mock`. Nie wykonano wywołania modelu.

## Wynik

| Obszar | Status | Dowód | Pozostało |
|---|---|---|---|
| QA API | PASS | `http://127.0.0.1:3316/api/health` zwrócił `{"status":"ok"}`; wykonano też kontrole UI/API w przeglądarce. | Brak dla samego health checka. |
| QA UI w Chrome | PASS | Otwarty `http://localhost:5288/`; drzewo dostępności pokazało Kalio, Talk, Settings oraz istniejącą historię sesji. | W runie 16 nie wykonano pełnego przepływu tworzenia projektu. |
| Playwright Orchestrator w Kalio | PASS | Settings → MCP Servers pokazało `playwright-orchestrator` jako connected i 26 dostępnych narzędzi; zrzut: [MCP Servers](assets/mcp-servers-connected.png). Izolowana sesja przeglądarkowa otworzyła UI QA; `collect_runtime_signals` zwróciło `passed`, `findings=[]`. | Brak dla smoke testu. |
| Polityka headless Orchestratora | PASS — override celowy | Żądanie sesji `headless=true` wróciło jako `headless=false`; odczyt konfiguracji pokazał `forceVisibleBrowsers=true`. Inspekcja źródeł potwierdziła, że SessionManager stosuje tę politykę i przekazuje efektywną wartość do BrowserPool. Istniejący test SessionManager sprawdza override. | Brak MCP-level testu przekazania żądania i serializacji odpowiedzi. Testów nie uruchomiono; checkout usługi jest poza prawem zapisu tej sesji. |
| Proces usługi Playwright MCP | PASS — punktowo / DEBT | Inwentarz dev-servers o 15:33 UTC pokazał usługę running na `:3333` (PID 61072), `autostart=true`, `restartOnExit=false`, licznik `restartCount=427`; smoke MCP przeszedł. | Licznik jest historyczny i nie wyjaśnia bieżącej stabilności; wyjaśnić go osobno. |
| Pozostałe serwery MCP | FAIL | W tym samym widoku Kalio widniało `Connected 1/2`; `data-analyst` zgłaszał `fetch failed`. | Zdiagnozować połączenie Data Analyst w osobnym zakresie. |
| Most Devin ↔ Kalio | PASS (konfiguracja) | Settings → Integrations pokazało Devin CLI online, ACP dostępne, SWE-2 High online i włączony most Kalio; zrzut: [Devin bridge / native tools](assets/devin-bridge-native-tools.png). | Bieżąca konfiguracja nie jest równoznaczna z nowym wywołaniem agenta w runie 16. |
| Własne narzędzia Devin | PASS (wyłączone) | Na zrzucie przełączniki Devin Filesystem, Web i Terminal są wyłączone. | Brak. |
| Odczyt/zapis przez Kalio dla Devin | PASS — historyczny | [Raport runu 13](../qa-run-13/report.md) odnotowuje `fs_read → fs_write (HITL) → fs_read` dla `E:/Projekty/home-site/package.json`: 21 linii, 415 B; zapisano identyczną treść i odczyt kontrolny był zgodny. Był to no-op, nie zmieniono pliku. | Nie powtarzano zapisu w runie 16. |
| Przekazanie Playwrighta do persony Devin | BLOCKED | Playwright jest widoczny na poziomie połączeń Kalio, ale persona Devin miała wcześniej allow-listę 6 z 59 narzędzi i nie miała narzędzi Playwright. Ocena Luna Max: nie przydzielać surowych 26 narzędzi. Statyczny przegląd znalazł możliwość auto/bypass/unattended approval w globalnym HITL; efektywnego trybu nie weryfikowano. Ograniczenie originu/sesji również nie jest udowodnione. | Najpierw bezpieczna fasada ograniczona do konkretnego QA originu i sesji oraz wymuszony, niezależny HITL; dopiero potem kontrolowany canary. |
| Stabilny serwer QA | PASS — punktowo | UI `:5288` i API `:3316` odpowiadały w trakcie tego przebiegu. | To punktowa kontrola; nie zastępuje testu generowania strony przez Devin. |
| Dev stack i okna `cmd.exe` | FAIL — root cause nieustalony | `kalio-forever` na `E:\Projekty\kalio-forever` miał `restartCount=15`; poprzedni proces zakończył się `exitCode=1`, a logi startu z 27.09 występują mniej więcej co 5 min 10–20 s od 14:10 do 15:28 UTC. Widziany skrypt `start-dev.ps1` monitoruje backend/Vite co 400 ms, a po wyjściu któregoś zatrzymuje oba procesy. | Dostępne logi backendu nie wskazały, który proces kończy pracę ani dlaczego. Brak pomiaru liczby `cmd.exe` przed/po konkretnej akcji, więc nie przypisuję wcześniejszego „spamu” Codexowi, Kalio ani agentowi. |

## Devin: co faktycznie jest dostępne

Playwright Orchestrator jest już połączony z Kalio i widoczny w globalnym widoku MCP. To nie oznacza, że Devin ma go na swojej allow-liście: w dotychczasowej konfiguracji Devin otrzymywał jedynie wąski zestaw narzędzi Kalio, a globalne narzędzia Playwright nie były mu delegowane. Most Kalio był włączony, zaś natywne Devin Filesystem/Web/Terminal były wyłączone. Historia UI zawiera zakończony canary z odpowiedzią `KALIO_DEVIN_QA_CURRENT_OK`, ale pochodzi on sprzed kilku dni — nie jest nowym wywołaniem ani dowodem dla runu 16.

Poprzedni odczyt/zapis przez Kalio przeszedł z HITL. Własne natywne narzędzia Devin pozostają osobno zablokowane; przez to kontrolowany zestaw Kalio MCP jest właściwą granicą dostępu. Nowego narzędzia ani szerszego dostępu nie przydzielono.

Agent Playwright potwierdził, że `headless=false` jest oczekiwanym wynikiem przy aktywnym `forceVisibleBrowsers=true`, a nie błąd przekazania MCP. Istnieje test managera dla override, ale brakuje testu granicy MCP (forwardowanie wejścia i serializacja efektywnej odpowiedzi); agent nie uruchamiał testów ani nie zmieniał plików, bo checkout usługi jest poza prawem zapisu tej sesji. Ustawienia operatora nie zmieniano.

## Incydent restartów / `cmd.exe`

Potwierdzony fakt to cykliczne wychodzenie zarządzanego dev procesu z kodem `1` i jego wznowienia przez ustawienie `restartOnExit=true`. W logach aplikacji z badanego okna są wpisy zdrowego startu Nest i `TSC Found 0 issues`, ale brak stack trace lub komunikatu identyfikującego zakończony proces. `start-dev.ps1` po wykryciu wyjścia backendu albo Vite zatrzymuje stos; zatem restart managera jest zgodny z cyklem procesu, ale nie dowodzi przyczyny ani źródła wielu okien `cmd.exe`.

Nie wykonano ubijania procesów, restartu usługi ani testu prowokującego awarię. Nie przypisano zachowania temu agentowi ani innemu agentowi. Następna diagnostyka powinna być jednym, ograniczonym odczytem drzewa procesów z PID/rodzicem/komendą (sekrety usunięte) przed i po konkretnym, autoryzowanym działaniu; jeśli licznik rośnie, zakończyć pomiary i nie zamykać obcych procesów.

## Dowody i ograniczenia

- Chrome: live UI `localhost:5288` oraz aktualne drzewo dostępności; karta utworzona przez poprzednią próbę dla endpointu Devin zwróciła `ERR_BLOCKED_BY_CLIENT` i została zamknięta. Nie traktuję blokady rozszerzenia Chrome jako błędu API; bezpośredni health API był OK.
- Playwright: test wykonano w osobnej efemerycznej sesji przeglądarki. Zrzuty w `assets/` pochodzą z tej sesji, a nie z karty Chrome użytkownika.
- Brak nowego wywołania Devin SWE-2 w tym przebiegu; status obecnego bridge jest dowodem konfiguracji, nie nowym testem ACP.
- Nie modyfikowano `home-site`, konfiguracji MCP, persony Devin, usługi dev ani innych serwerów. Wcześniejsze zmiany robocze w repo, w tym edytowany skill `docs/agent-skills/kalio-manual-qa.md`, pozostawiono bez zmian.

## Priorytety

- [P2] Zidentyfikować, który proces kończy dev stack co ok. 5 minut; obecnie nie wiadomo, czy jest to źródło obserwowanych okien `cmd.exe`.
- [P2] Naprawić `data-analyst` (`fetch failed`) lub jawnie wyłączyć go w profilu QA.
- [P1] Zablokować przekazanie zewnętrznego MCP Playwright do Devin: statyczny przegląd znalazł ścieżki auto/bypass/unattended approval, które mogą ominąć gwarancję bezwzględnego HITL; bieżącego efektywnego trybu nie sprawdzano.
- [P2] Nie delegować surowych 26 narzędzi Playwright do Devin przed ograniczeniem originu/sesji oraz potwierdzeniem wymuszania HITL.
- [P2] Wyjaśnić historyczny licznik 427 restartów usługi Playwright MCP; w tym przebiegu była running i jej smoke przeszedł.

Zakres obejmuje wyłącznie punktową QA konfiguracji MCP/bridge i odczyty runtime. Nie zamyka testu generowania strony React w `home-site` przez rzeczywistego Devin SWE-2.
