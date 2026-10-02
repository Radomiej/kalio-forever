# QA run 7 — Devin SWE-2 przez Kalio

**Data:** 2026-09-26, Europe/Warsaw  
**Werdykt:** `CONDITIONAL` — lokalny przebieg Devin→Kalio→HITL→fs_write→fs_list przeszedł; uruchomienie i wizualna kontrola wygenerowanej strony są zablokowane brakiem zależności i zakazem instalacji.  
**Zakres:** jedna lokalna próba Devin ACP na modelu `swe-2-high`, wybranym zgodnie z prośbą użytkownika o darmowy SWE-2; bez niezależnej attestacji rozliczenia i bez testowania aplikacji Devin poza Kalio.

## Środowisko i granice

- Checkout: `C:\Users\Radomiej\.codex\worktrees\5a7e\kalio-forever`, `HEAD` detached. Checkout był już mocno zmodyfikowany przed raportem; nie porządkowałem ani nie resetowałem obcych zmian.
- Stabilne QA: UI `http://127.0.0.1:5288/` (in-app browser, 1280×720); skonfigurowany API `http://localhost:3316/`; dane w `%LOCALAPPDATA%\kalio-forever-qa` (`kalio-qa.db` i `workspaces`). UI odpowiadał podczas tej próby. Nie restartowałem usługi.
- Próba otwarcia `http://127.0.0.1:3316/api/health` w in-app browser została zablokowana przez klienta (`ERR_BLOCKED_BY_CLIENT`); nie traktuję jej jako dowodu stanu API.
- Sesja Kalio: `New Chat`, session ID `83OoPl9nF23bHuOrxLXop`; projekt `Home Site`, dokładna ścieżka `E:/Projekty/home-site`.
- Agent/persona: `Devin CLI · swe-2-high`, persona `Devin SWE-2 QA`, profil `devin-local-swe-2-high`. Dozwolone: `fs_list`, `fs_read`, `fs_write`, `terminal_spawn/list/output`; natywne FS/web/terminal wyłączone. Terminalu nie użyto.
- `/api/llm/config` z wcześniejszej kontroli tego QA wskazywał `mock/mock`, źródło `env`; konfiguracji providera nie zmieniałem. Statyczny gate `agentflow:paid-readiness -- --static-only` miał 4 blokady: mock provider, źródło env, brak zapisanych live credentials i brak aktywnego credentiala. Nie był to płatny run ani live-provider test; kontynuacja była ograniczona do jawnie autoryzowanego lokalnego canary.
- Brak zależności potwierdzono najpierw pustym `fs_list` korzenia. Nie wykonano `npm install`, builda, testów strony ani żądań do internetu.

## Przebieg i surowe dowody

1. Świeże `fs_list` zwróciło pusty katalog `E:\Projekty\home-site` (`entries: []`, `omitted: 0`).
2. Devin przygotował stronę firmy IT NEXORA w React/Vite, po jednym pliku na wywołanie `fs_write`; każde zatwierdzenie sprawdziłem ręcznie w Kalio dla konkretnej ścieżki i treści.
3. Po zapisach świeże `fs_list` korzenia zwróciło:

   ```json
   {"path":"E:\\Projekty\\home-site","entries":[{"path":"index.html","type":"file","sizeBytes":527},{"path":"package.json","type":"file","sizeBytes":415},{"path":"src","type":"directory"}],"omitted":0}
   ```

   `fs_list` dla `src` zwróciło:

   ```json
   {"path":"E:\\Projekty\\home-site\\src","entries":[{"path":"App.jsx","type":"file","sizeBytes":10906},{"path":"main.jsx","type":"file","sizeBytes":237},{"path":"styles.css","type":"file","sizeBytes":11700}],"omitted":0}
   ```

4. `fs_read` odczytał dokładne `package.json`; plik jest poprawnym JSON-em. Deklaruje React/React DOM `^18.3.1`, Vite `^5.4.11` i plugin React `^4.3.4` oraz skrypt `build: vite build`.
5. Audyt session `83OoPl9nF23bHuOrxLXop` pokazał `llm.turn.completed` po 553,8 s. Po odświeżeniu Talk znacznik konwersacji zmienił się z mylącego „FS_WRITE RUNNING” na „Completed”.
6. Po zbudowaniu źródeł Devin sam zgłosił blokadę: brak `node_modules` i potrzeba osobnej zgody na instalację/build. Nie uruchomiłem tych komend, zgodnie z zakresem.

## Akceptacja

| AC | Status | Dowód | Pozostała granica |
|---|---|---|---|
| AC-01 stabilne QA/UI | PASS | In-app browser `127.0.0.1:5288`, viewport 1280×720; sesja i projekt widoczne w Talk | API 3316 nie było niezależnie odpytywane w tej kontynuacji |
| AC-02 właściwy Devin przez Kalio | PASS | Persona `Devin SWE-2 QA`, `Devin CLI · swe-2-high`; ukończony lokalny ACP turn i rzeczywiste wyniki MCP | Nie jest to test providera LLM Kalio ani produkcji |
| AC-03 brakujące pliki i zakres ścieżek | PASS | Początkowy pusty `fs_list`; końcowe `fs_list` korzenia i `src` pokazują dokładnie 5 nowych plików w zatwierdzonym projekcie | Treści JSX/CSS nie zostały uruchomione w przeglądarce |
| AC-04 ręczny HITL `fs_write` | CONDITIONAL | 5 zapisów zatwierdzonych pojedynczo z Home → Ongoing actions po porównaniu ścieżki/treści z audytem | Karty nie pojawiły się inline w Talk; w audycie były ponawiane prośby po anulowaniu około 60 s |
| AC-05 poprawność `package.json` | PASS | Dokładny `fs_read` w Kalio; prawidłowy JSON, 21 linii | Poprawność bundla zależy od instalacji pakietów |
| AC-06 build, test i wygląd strony | BLOCKED | Katalog startował pusty; brak zależności; instalacja i terminal pozostawione niewykonane zgodnie z zakresem | Wymaga dostarczenia zależności lub osobnej decyzji o instalacji i uruchomieniu builda |
| AC-07 koniec przebiegu widoczny w UI | CONDITIONAL | Audyt: `llm.turn.completed`; reload Talk przywrócił „Completed” | Wcześniej Talk pokazywał nieaktualne „FS_WRITE RUNNING” |

## Znaleziska

| Priorytet | Znalezisko | Wpływ | Dowód | Status |
|---|---|---|---|---|
| P2 | Potwierdzenie HITL nie było widoczne inline w Talk; request był dostępny w Home → Ongoing actions. W ciągu 5 zapisów audyt zawierał 5 zatwierdzeń i 5 anulowań około minutę po request; Devin ponawiał ten sam zapis. | Zwiększa ryzyko niejasnego/starego zatwierdzenia i tworzy zbędne powtórzenia. Anulowania traktuję jako prawdopodobne wygaśnięcia, nie potwierdzone odrzucenia użytkownika, bo sam event nie koduje tu jawnej przyczyny. | Screenshoty 05–11 oraz HITL audit dla dokładnej sesji; końcowe CSS zatwierdzone z Home. | Odtworzone; naprawa UI poza zakresem tej próby. Instrukcję repo QA zaktualizowałem. |
| P2 | Wygenerowana strona nie została zbudowana ani obejrzana. | Nie można potwierdzić, że strona uruchamia się i jest responsywna w przeglądarce. | Agent zgłosił brak `node_modules`; terminal i instalacja nie zostały użyte. | BLOCKED zgodnie z ograniczeniem zakresu. |
| P3 | W przejrzanym payloadzie `src/App.jsx` element `<figcaption>` był bezpośrednim dzieckiem `<div className="opinia">`, a nie `<figure>`. | Błędna semantyka HTML w sekcji opinii; nie blokuje samego zapisu pliku. | Payload `fs_write src/App.jsx` z tej sesji. | Do poprawy przez Devin/Kalio w kolejnym autoryzowanym przebiegu; plików nie edytowałem ręcznie. |

## Zrzuty ekranu

Wszystkie obrazy są w `assets/`; nazwy 01–09 zachowują kolejność poprzednich kroków tej samej próby. Najważniejsze:

- [02 — Talk gotowy](assets/02-talk-ready.png)
- [04 — początkowy pusty katalog](assets/04-fs-list-completed.png)
- [06 — karta zatwierdzenia Home](assets/06-home-approval-card.png)
- [10 — zatwierdzenie CSS](assets/10-styles-css-approval.png)
- [11 — Talk ze starym „FS_WRITE RUNNING” po ukończeniu treści](assets/11-talk-after-css-approval.png)
- [12 — odczyt `package.json`](assets/12-package-json-read.png)
- [13 — końcowe surowe listy korzenia i `src`](assets/13-final-root-fs-list.png)

## Podsumowanie

Kalio wykonało rzeczywisty lokalny przebieg Devin SWE-2: sprawdziło pusty projekt, poprosiło o ręczne zatwierdzenia, zapisało 5 plików i zweryfikowało je przez `fs_list`/`fs_read`. Sama ścieżka akceptacji działa przez Home, ale inline Talk i obsługa powtarzanych/wygaśniętych requestów wymagają poprawy. Nie ma dowodu na build ani działającą stronę w przeglądarce; brak `node_modules` był granicą testu, nie awarią Kalio.
