# QA run 14 — stable Kalio QA, Playwright MCP, Devin dispatch control

**Data:** 2026-09-27 (Europe/Warsaw)  
**Werdykt:** `CONDITIONAL`. Stable QA and a real Playwright MCP tool sequence worked. A local mock chat also completed. A new Devin run was not established, so this is not Devin execution proof and no native-Devin-tool denial claim is made.

## Środowisko i granice

- Kalio stable QA UI: `http://localhost:5288/`; API: `127.0.0.1:3316`. The observed API health was `ok`; effective LLM provider was `mock` from `env`.
- Kalio dev service: ports `3016/5188`, running with `autostart=false`.
- Playwright Orchestrator managed service: MCP/REST port `3333`, health `ok`, process running (`restartOnExit=false`, `restartCount=427`, `autostart=true` in the observed service state).
- Home Site remains `E:/Projekty/home-site`. This run did not access or modify its files and did not run its preview/build.
- No Devin model request was successfully observed in this run; no paid or free quota was consumed by this test as far as the available evidence shows. SWE-2's free-quota status was not independently verified.
- No app source, service configuration, or external project files were changed. This report and the screenshot are the only run14 artifacts.

## Macierz akceptacji

| AC | Status | Dowód | Granica / pozostała praca |
|---|---|---|---|
| AC-01 — stable QA po restarcie | PASS | UI widoczne w Chrome pod `localhost:5288`; API health `ok`; efektywny provider `mock`. | Dowód lokalny; bez wniosków o produkcji. |
| AC-02 — Playwright Orchestrator jest osiągalny z Kalio | PASS | UI Tools → MCP pokazało `playwright-orchestrator`, 26 tools, endpoint `127.0.0.1:3333/mcp`; health endpoint zwrócił `ok`. Screenshot poniżej. | `data-analyst` w tym samym widoku zgłasza `fetch failed`. |
| AC-03 — rzeczywiste wywołania MCP Playwright | PASS | Przez endpoint MCP wykonano `browser_session_create` (izolowana sesja), `browser_page_new` dla QA UI, snapshot, kliknięcia elementów zaobserwowanych w DOM, kolejny snapshot, `take_snapshot` PNG i `browser_session_close`; sesja została zamknięta. | Chromium sesji Orchestratora jest odizolowane; nie jest to dowód, że Devin może wywołać te tools ani że działa to w profilu użytkownika Chrome. |
| AC-04 — lokalna ścieżka tworzenia czatu i odpowiedź mock | PASS jako kontrola przepływu | W Chrome utworzono czat `QA Control Only`; UI wskazało `Local LLM`; odpowiedź `[MockLLM] Echo: ...` pojawiła się, a czat zakończył się jako `Completed`. | Mock odbił prompt, zamiast zwrócić dokładnie `MOCK_CHAT_OK`; potwierdza dispatch/persist/render lokalnego czatu, nie jakość rzeczywistego modelu. |
| AC-05 — Devin dispatch przez nowy czat | BLOCKED / bez potwierdzenia | Poprzednia próba `Run` wybraną personą Devin nie utworzyła widocznej sesji ani nowego audit event; kontrolny czat Default/mock zadziałał. | Przyczyny po stronie adaptera/UI/hosta nie rozstrzygnięto. Nie powtarzano wywołania Devin w ciemno. |
| AC-06 — odczyt/zapis plików przez narzędzia Kalio | PASS historycznie; niepowtórzone w run14 | Poprzednie QA czaty zawierają udokumentowane `fs_list`, `fs_read` i zatwierdzony osobnym HITL no-op `fs_write` do `E:/Projekty/home-site/package.json`; odczyt po zapisie miał identyczne 415 B. Wcześniejsze zatwierdzone edycje Home Site i build Vite również są w historii QA. | To dowód wcześniejszego runu, nie świeżego wywołania Devin po obecnym restarcie. Run14 nie wykonał żadnego file tool. |
| AC-07 — persona Devin widzi ograniczone tools Kalio | PASS jako konfiguracja, nie jako aktualny wywołany Devin run | Ostatni odczyt ustawień persony: 6/59 tools (`fs_read`, `fs_list`, `fs_write` z confirm, `terminal_spawn` z confirm, `terminal_list`, `terminal_output`), `MCP allow_list`, panel „No MCP servers connected”. | Nie zweryfikowano dynamicznego przekazania tools do nowej sesji Devin ani kompletnego egzekwowania poza ustawieniami Kalio. |
| AC-08 — native tools Devina są blokowane | UNVERIFIED | Ustawienia persony deklarują brak native FS/Web/Terminal i niepodłączone MCP; Luna zaleciła nie przydzielać surowych Playwright tools. | Nie wywołano natywnego narzędzia Devina w tej próbie, więc brak testu negatywnego end-to-end. |
| AC-09 — naprawa źródła Playwright i restart loop | BLOCKED | Historyczne logi zawierają 6 601 trafień `TS2688: Cannot find type definition file for 'node'`; stan usługi raportował `restartCount=427`. Obecnie usługa działa z `restartOnExit=false`. | Agent Sartre nie uzyskał dostępu do checkoutu `E:\Projekty\mcp-playwrigh-master` spoza dozwolonego workspace; nie odczytał ani nie zmienił źródeł. Nie można przypisać historycznych restartów konkretnemu agentowi. |
| AC-10 — screenshot do raportu | PASS | Zapisano zrzut panelu Tools → MCP: [`kalio-mcp-playwright-tools.png`](assets/kalio-mcp-playwright-tools.png). | Zrzut pokazuje konfigurację MCP w QA UI; nie jest zrzutem nowej sesji Devin. |

![Kalio Tools → MCP: Playwright Orchestrator dostępny, Data Analyst z błędem](assets/kalio-mcp-playwright-tools.png)

## Wyniki i diagnoza

### Playwright Orchestrator

MCP działa na poziomie realnego wywołania: utworzenie izolowanej sesji, nawigacja wyłącznie do `localhost:5288`, snapshot DOM, kliknięcia, snapshot PNG i zamknięcie sesji przeszły. Panel Kalio pokazuje 26 narzędzi. Nie są one przypisane personie Devin i Luna Max oceniła szerokie przypisanie wszystkich 26 jako `NO-GO` bez kontroli ownership sesji i allowlisty originów.

### Devin i toole

Konfiguracja persony udostępnia sześć jawnie wybranych narzędzi Kalio, z HITL dla zapisu i terminala; panel MCP persony jest pusty. To oddziela tools Kalio od natywnych integracji hosta, ale nie dowodzi, że klient Devin odrzuciłby każdą natywną próbę. Brak nowego wpisu sesji/audytu po próbie Devin, w kontraście do działającego czatu mock, zawęża problem do ścieżki Devin lub jej dispatchu, ale nie wskazuje jeszcze konkretnego błędu.

### Powtarzające się procesy CMD

W logach historycznych są tysiące powtórzeń błędu kompilacji TypeScript, a managed service ma 427 restartów. To wspiera hipotezę pętli startowej/watchdoga wokół `npm.cmd`/builda, ale nie dowodzi, kto ją inicjował ani że była to akcja konkretnego agenta. Obecne `restartOnExit=false` jest containment, nie naprawą źródłową. Repo Orchestratora nie było dostępne w tym workspace, więc diagnoza pozostaje częściowa.

## Agenci i delegacja

- Luna Max (`gpt-6-luna`, reasoning `max`) zakończyła przegląd bezpieczeństwa: nie podłączać Devinowi surowego zestawu 26 narzędzi; najpierw wąska fasada z izolacją sesji/originów, HITL i audytem.
- Agent Sartre dostał informację o błędzie `TS2688` i restart loop, ale był zablokowany poza checkoutem Playwright; nie wykonał naprawy.
- `data-analyst` pozostaje widoczny w Kalio, ale ma `fetch failed`; nie jest częścią pozytywnego wyniku Playwright.

## Findings / następne kroki

| Priority | Finding / action | Impact | Evidence | Resolution |
|---|---|---|---|---|
| P2 | Devin dispatch niepotwierdzony po resecie. | Nie można zamknąć QA realnego modelu ani twierdzić, że Devin korzysta z dozwolonych tools. | Brak nowej sesji/audytu w próbie Devin; kontrola mock przeszła. | Najpierw zdiagnozować adapter/host dispatch bez ponawiania potencjalnie płatnego runu; potem wykonać pojedynczy run dopiero po potwierdzeniu modelu i kosztu. |
| P2 | Native Devin tool denial nie ma dowodu end-to-end. | Nie wiadomo, czy blokada działa w runtime klienta, a nie tylko w konfiguracji Kalio. | Persona i panel MCP wskazują ograniczenia, ale brak próby natywnego tool call. | W kontrolowanym QA sprawdzić negatywny przypadek i wpis audytu, bez szerszego grantowania dostępu. |
| P2 | Źródłowy build Playwright pozostaje nienaprawiony. | Restart-loop root cause niezamknięty; watchdog obecnie wyłączony. | `TS2688`, `restartCount=427`, brak prawa zapisu do zewnętrznego checkoutu. | Udostępnić checkout jako autoryzowany workspace agentowi naprawczemu; dopiero wtedy inspekcja lockfile/typów i czysty build. |
| P3 | Data Analyst MCP nie odpowiada. | Drugi skonfigurowany MCP nie jest gotowy do użycia. | UI: `fetch failed`. | Oddzielnie sprawdzić jego endpoint/managed service. |

## Granice dowodu

Run14 potwierdza lokalny stable QA, rzeczywiste wywołania Playwright Orchestratora z Kalio QA oraz dispatch/persist/render czatu przez provider mock. Nie potwierdza nowego wywołania Devin, rozliczenia SWE-2, natywnego tool denial, naprawy źródłowej Orchestratora, mobile/keyboard accessibility, ani produkcji. Wyniki `fs_*`, zapis strony i jej build pochodzą z wcześniejszych czatów QA i są tu oznaczone jako historyczne.
