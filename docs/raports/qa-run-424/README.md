# QA424 — kontrolowany Recheck z dwoma monitorami

Data lokalna 2026-10-05. Bez restartu QA, zmian providerów lub live LLM. Najpierw uruchomiono monitor Toolhelp32 i hook okien; dopiero po obu READY wykonano jeden POST /api/cli-agents/refresh. HTTP 201, oba monitory exit 0.

Okno procesów UTC 2026-10-04 22:37:33.408–22:37:58.426, 809 próbek, maxSampleGapMs 46.7595. Backend QA PID 22164 uruchomił:

| Agent / audit createdAt | Łańcuch wykrytych PID |
| --- | --- |
| copilot / 1791153453447 | 22164 → cmd 25168 → node 14096 → copilot 49308 → copilot 28960; cmd 25168 → conhost 26436 |
| gemini / 1791153454211 | 22164 → cmd 46916 → node 50084 → node 28324 → cmd 46412; cmd 46916 → conhost 51300 |
| claude / 1791153455616 | 22164 → cmd 31668 → claude 40048; cmd 31668 → conhost 53376 |
| codex / 1791153455855 | 22164 → cmd 3488 → node 20068 → codex 58872; cmd 3488 → conhost 58556 |

Audit filter label=process.cmd.invocation, since=1791153453426, limit=20 zwrócił cztery wpisy cli-agent.probe. Procesy obserwowano około 22:37:33.483–22:37:35.934. Powiązanie agentów opiera się na kolejności audytu oraz rozpoznanych potomkach; nie zbierano argv.

W tym samym pomiarze były też powtarzające się docker.exe → conhost.exe pod Docker Desktop PID 16952. To osobny właściciel. Dodatkowy cmd PID 55136 miał rodzica 1860, nie QA; nie ustalono właściciela i nie zmieniano tego procesu.

Hook okien: tylko dwa class=unavailable dla HWND 4654578 (create/destroy) około 22:37:41.589; brak PID i klasy. Nie można przypisać ich QA ani Docker. Brak sklasyfikowanego widocznego okna nie wyklucza krótkich błysków.

| AC | Status | Dowód | Pozostałe |
| --- | --- | --- | --- |
| CONSOLE-03: właściciel czterech CMD i conhost Recheck | PASS | Backend PID oraz łańcuchy z Toolhelp i cztery audit records | Rzeczywista widoczność nieznana |
| CONSOLE-01: brak widocznych błysków | UNVERIFIED | Hook nie przypisał widocznego okna | Czułość hooka na prawdziwą konsolę lub inna metoda korelacji |

Nie zmieniono kodu runtime; nie wyłączano automatycznej detekcji w celu ukrycia objawu. Wszystkie testowe monitory zakończyły się i nie pozostawiono ich w tle. Cel pozostaje aktywny.
