# QA run 8 — Devin SWE-2, HITL i wynik narzędzia

**Data:** 2026-09-26, Europe/Warsaw  
**Werdykt:** `CONDITIONAL` — stabilne QA, ręczne zatwierdzenie i propagacja wyniku `fs_write` zostały potwierdzone w Kalio. Wygenerowanej strony nie zbudowano ani nie wyrenderowano.  
**Zakres:** rzeczywisty lokalny Devin CLI ACP `swe-2-high` użyty przez UI Kalio w projekcie `Home Site`; kontrola naprawionego obiegu HITL po przebudowie stabilnego QA; bez instalacji zależności, terminala w projekcie strony, sieci ani zmian poza zatwierdzonym celem. QA nie było ponownie restartowane podczas no-op canary.

## Środowisko i granice

- Checkout Kalio: `C:\Users\Radomiej\.codex\worktrees\5a7e\kalio-forever`, `HEAD` detached i wiele istniejących zmian. Nie resetowałem, nie stashowałem ani nie porządkowałem obcych zmian.
- Stabilne QA: UI `http://127.0.0.1:5288/`, API `http://127.0.0.1:3316/`; dane w `%LOCALAPPDATA%\kalio-forever-qa` (`kalio-qa.db`, `workspaces`). Bieżące GET `/api/health` zwróciło `{"status":"ok"}`; `/api/llm/config` zwróciło `provider=mock`, `model=mock`, `source=env`. To konfiguracja Kalio, nie modelu procesu Devin CLI.
- UI: in-app browser/Codex QA oraz dodatkowy izolowany, tylko do odczytu kontekst Playwright; viewport zrzutu `1280×720`. Zrzut rozmowy zapisano w `assets/01-tool-result-done.png`; przy odczycie UI nie zarejestrowano błędów console/page.
- Projekt: `Home Site`, dokładna ścieżka `E:/Projekty/home-site`; sesja widoczna jako `New Chat`. Agent: lokalny `Devin CLI · swe-2-high`, persona `Devin SWE-2 QA`. Darmowy status modelu nie był niezależnie potwierdzony przez billing.
- Devin pracował tylko narzędziami Kalio. Zatwierdzałem pojedynczą prośbę `fs_write` ręcznie po kontroli ścieżki; nie włączono autoakceptacji. Nie użyto terminala, instalacji ani sieci w `home-site`.

## Przebieg i wynik

1. W poprzednim przebiegu Devin utworzył w pustym projekcie pięć plików React/Vite. Przez `fs_read` wykryto, że cytat miał kontener `<div className="opinia">` z bezpośrednim `<figcaption>`.
2. Po korekcie backendu QA Devin przez Kalio odczytał `src/App.jsx` i wykonał zatwierdzony zapis zmieniający kontener opinii na `<figure className="opinia">` z pasującym `</figure>`. Odpowiedź kolejnego `fs_read` w UI potwierdziła tę strukturę.
3. Drugi przebieg służył testowi cyklu: Devin ponownie odczytał ten plik i wysłał jeden `fs_write` do tej samej ścieżki. Potwierdzenie HITL było dostępne inline w Talk; zaakceptowałem tylko tę prośbę.
4. Po zatwierdzeniu aktywność `fs_write` w Talk przeszła od razu do zakończonej — bez odświeżania. Devin otrzymał `tool:result`; odpowiedź pokazała ścieżkę `E:\Projekty\home-site\src\App.jsx` i `bytesWritten: 10 912`.
5. Zrzut ekranu dokumentuje końcową odpowiedź rozmowy oraz widoczny komunikat „Cykl HITL zakończony”. Devin opisał zapis jako bajtowo identyczny no-op, ale sam rozmiar 10 912 B nie dowodzi identyczności; niezależnego hasha ani osobnego odczytu po tym drugim zapisie nie wykonano.

## Macierz akceptacji

| Kryterium | Status | Dowód / granica |
|---|---|---|
| Stabilny QA na stałych portach | PASS | UI `127.0.0.1:5288`; API `127.0.0.1:3316`; bieżące health `ok`. |
| Efektywny provider Kalio znany | PASS | Bieżące `/api/llm/config`: `mock/mock`, źródło `env`; run nie był płatnym testem providera Kalio. |
| Rzeczywisty Devin przez Kalio na zatwierdzonym projekcie | PASS | Persona `Devin SWE-2 QA`, model CLI `swe-2-high`, projekt `E:/Projekty/home-site`; wykonane żądania MCP w rozmowie. Billing-free nieattestowany. |
| Ręczna akceptacja, bez autoakceptacji | PASS | Konkretny request `fs_write` sprawdzony i zaakceptowany w UI. |
| Inline HITL w Talk | PASS po naprawie | Żądanie oczekujące było widoczne w Talk z akcjami potwierdzenia/anulowania. |
| Zakończenie `fs_write` bez reloadu | PASS po naprawie | Live Talk zmienił aktywność na zakończoną; odpowiedź zawiera `tool:result`. Screenshot końcowej rozmowy: [01 — wynik cyklu HITL](assets/01-tool-result-done.png). |
| Semantyczna poprawka opinii w projekcie | PASS w granicy Kalio | Devin przez `fs_write` zmienił `<div>` na `<figure>`; odpowiedź `fs_read` w UI potwierdziła `<figure>`, `<blockquote>` i `<figcaption>`. Nie czytałem pliku poza Kalio. |
| Bajtowa identyczność drugiego zapisu | INCONCLUSIVE | Agent zadeklarował no-op; zgłoszony rozmiar przed/po to 10 912 B. Brak niezależnego hasha i odczytu po zapisie. |
| Build/test/wizualny podgląd wygenerowanej strony | BLOCKED | Projekt nie ma `node_modules`; zgodnie z zakresem nie uruchomiono instalacji ani terminala i nie otwarto samej strony w przeglądarce. |
| Produkcja | NOT RUN | QA jest lokalne i korzysta z mock providera; brak wdrożenia i dowodu produkcyjnego. |

## Naprawione problemy Kalio i weryfikacja kodu

| Priorytet | Problem | Zmiana / dowód |
|---|---|---|
| P2 | Live ACP/MCP prośba o zatwierdzenie nie miała wpisu narzędzia w osi czasu, więc Talk nie renderował inline karty HITL. | `ConversationTimeline.tsx` renderuje niezdublowane aktywności `awaiting_confirmation`; regresja w `ChatInterface.test.tsx`. Test pliku: 93/93; web typecheck i build przeszły. |
| P2 | Most Kalio MCP nie emitował `tool:result` po dispatch, więc Talk zostawiał aktywność jako running do reloadu. | `KalioMcpBridgeService` emituje wynik po zakończeniu dispatch. Spec mostu: 8/8; API typecheck i build przeszły (638 plików skompilowanych). |
| P3 | Build frontendu wypisał istniejące ostrzeżenie o chunku >500 kB. | Build zakończył się poprawnie; rozmiar chunku nie był celem tego QA. |

Dokładne polecenia testów i kody wyjścia z wcześniejszych gate’ów nie zostały zachowane w artefakcie tego przebiegu; powyżej podaję tylko zapamiętane wyniki, bez dopisywania niezweryfikowanych komend.

## Dodatkowa diagnoza `cmd.exe` i bezpieczeństwa

- [P3] Ostatni zliczony snapshot miał 62 `cmd.exe`, wobec wcześniejszego 60. Ograniczona próbka procesów pokazała m.in. launchery MCP Codex/Node (w tym Context7) oraz `next start` projektu Portal Muza. Ta próbka nie ustala właściciela całej różnicy ani przyczyny wzrostu; nie ma podstaw, by przypisać spam Kalio/Devinowi. Żadnego procesu nie zakończyłem i wstrzymałem dalsze szerokie zapytania o procesy.
- [P2] W jednym ograniczonym wyjściu diagnostycznym pojawił się argument przypominający klucz API Context7 z powodu nieskutecznej redakcji. Wartość pominięto w tym raporcie; użytkownik został już o tym poinformowany i zalecono rotację, jeśli credential jest aktywny. Nie wykonywałem rotacji.

## Podsumowanie

Próba potwierdziła działanie lokalnego obiegu Devin SWE-2 → Kalio UI → ręczny HITL → wynik narzędzia bez reloadu. Dwie usterki po stronie Kalio zostały naprawione i mają lokalne testy regresyjne oraz dowód w UI. Nie jest to dowód poprawnego builda ani wyglądu utworzonej strony: bez osobnej zgody na instalację/terminal pozostają one zablokowane. Procesów `cmd.exe` nie da się obecnie bezpiecznie przypisać tej próbie.
