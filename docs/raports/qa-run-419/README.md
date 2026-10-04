# QA419 — krótkie okna konsoli przy rozruchu

Data: 2026-10-05. Środowisko: stałe QA, UI localhost:5288, API 3316.

## Korekta kryterium akceptacji

Użytkownik nadal obserwuje około 4–5 okien, pojawiających się i znikających w ciągu kilku sekund przy rozruchu. Jest to zgłoszenie użytkownika, nie zarejestrowany przez ten run pomiar. Brak sklasyfikowanego okna w dotychczasowej obserwacji nie zamyka błędu.

| AC | Status | Dowód | Pozostałe |
| --- | --- | --- | --- |
| CONSOLE-01: brak krótkich widocznych konsol przy rozruchu | FAIL | Aktualne zgłoszenie użytkownika | Ustalić proces oraz rodzica w momencie zdarzenia; powtórzyć rozruch z aktywnym pomiarem |
| CONSOLE-02: przypisanie źródła | UNVERIFIED | Observer zachowuje zdarzenia class=unavailable, ale nie przypisuje im PID; wcześniejszy CIM observer został anulowany | Nie uznawać unknown za brak konsoli; nie powtarzać nieskutecznego CIM bez zmiany metody |
| CODEX-READ: kontrola trwającego testu QA418 | PASS, tylko odczyt UI | Ostatni bubble: QA418_CODEX_RESULT, name=nexora-home-site, scripts.build=vite build, fs_read oznaczone Kalio; Stop agent=0 | Osobny scoped audit i trwałość po F5 nie sprawdzone w tym runie |

## Inspekcja bez restartu

Znane ścieżki stack-manager backend/frontend oraz taskkill mają windowsHide=true. Wrapper spawnProcess przekazuje opcje do cmd.exe; sama obecność cmd.exe nie dowodzi widocznego okna.

kalio-cli ma świadomie widoczną ścieżkę foreground runServer oraz windowsHide=false dla update --auto. Brak dowodu, że te ścieżki uruchamiają się w stałym QA; nie zmieniono ich spekulacyjnie. repo-preflight ma wywołania spawn, lecz odczyt stack-manager nie wykazał odwołania do tego skryptu. Poprzednia poprawka openBrowser nie dowodzi usunięcia zgłoszonego objawu.

Nie restartowano QA ani Devin/Codex, nie resetowano ustawień, nie zmieniono kodu runtime. Nie wykonano nowego pomiaru widoczności okien. Werdykt dla eliminacji konsol: NO-GO.
