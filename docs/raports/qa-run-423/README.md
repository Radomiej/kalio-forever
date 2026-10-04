# QA423 — monitor procesów bez CIM

Data lokalna: 2026-10-05. Dodano osobne scripts/measure-process-snapshots.ps1 i behavioral test .test.mjs. Zachowano istniejący monitor CIM bez zmian.

Toolhelp32 monitor najpierw pobiera baseline, ogłasza readiness, następnie próbuje próbkować co 10 ms przez 1–60 sekund. Rejestruje wyłącznie nazwę, PID, parent PID i czas obserwacji. Nie uruchamia ani nie zabija procesów, nie odczytuje argumentów, środowiska lub tytułów. Handles zamyka finally. Raport podaje liczbę próbek i faktyczny maksymalny odstęp.

Behavioral test uruchamia prawdziwy monitor, czeka na readiness, tworzy ukryty proces Node trwający 400 ms i wymaga jego PID, poprawnego rodzica oraz dokładnie czterech bezpiecznych pól. RED: brak monitora, 1 FAIL. GREEN: 1 PASS, 3.714 s. Uruchomiono poza sandboxem systemowym Node. Test nie jest dowodem czułości na procesy krótsze od odstępu próbkowania ani widoczności okien.

Samodzielny pasywny odczyt, bez restartu QA: 2026-10-04T22:35:54.4759189Z–22:35:57.4899168Z, 98 próbek, maxSampleGapMs=32.0446. Wykryto docker.exe PID 43144, parent 16952 oraz conhost.exe PID 38032, parent 43144. Jest to dowód wykrycia potomka konsoli; nie dowodzi widocznego okna ani związku z Kalio. Nie wykonywano zmian Docker ani zatrzymywania tych procesów.

Odczyt Get-Process poza sandboxem potwierdził rodzica 16952 jako Docker Desktop (start 2026-10-04 10:27:44 lokalnie). Wykryty łańcuch należy więc do Docker Desktop; nie należy przypisywać go QA. Nie ustalono, czy ten conhost pokazał widoczne okno.

| AC | Status | Dowód | Pozostałe |
| --- | --- | --- | --- |
| CONSOLE-04: alternatywny odczyt PID/rodzic | PASS w zakresie 400ms fixture | Rzeczywisty behavioral test, brak CIM | PID reuse i procesy pomiędzy próbkami mogą umknąć |
| CONSOLE-01: brak błyskających konsol QA | UNVERIFIED | Brak kontrolowanego rozruchu w tym runie | Powiązać pomiar procesów i okien z czterema bootstrap probes |

Nie zmieniono aplikacji ani konfiguracji QA. Pełna suite po dodaniu skryptu nie została uruchomiona, skrypt nie jest jeszcze w root gate i nie został zakomitowany. Cel nadal aktywny.
