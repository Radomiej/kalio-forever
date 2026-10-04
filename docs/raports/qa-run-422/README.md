# QA422 — przypisanie czterech CMD do bootstrap probe

Data: 2026-10-05. Odczyt stałego QA API 3316, bez restartu i zmian runtime.

Scoped filtr audit: label=process.cmd.invocation, since=1791152230000, until=1791152280000, limit=30. Zwrócono dokładnie cztery zdarzenia:

| createdAt | source | agent | launcher / mechanism |
| --- | --- | --- | --- |
| 1791152250064 | cli-agent.probe | copilot | execFile / cmd |
| 1791152253648 | cli-agent.probe | gemini | execFile / cmd |
| 1791152256213 | cli-agent.probe | claude | execFile / cmd |
| 1791152256457 | cli-agent.probe | codex | execFile / cmd |

Łączny odstęp: 6393 ms. To mocniejszy kandydat dla zgłoszonych 4–5 krótkich okien przy starcie niż same przypuszczenia o czacie Devina. Nie jest jednak dowodem ich widoczności ani przypisaniem HWND/PID do tych wywołań.

Źródło CLIAgentProbeService.onApplicationBootstrap uruchamia refreshAllProbes dla czterech adapterów. Kolejka serializuje je; execFile ma timeout=5000 i windowsHide=true. Adaptery Windows używają cmd /c dla --version. W obserwowanym oknie audytu nie ma cmd z source devin.cli.probe lub devin.cli.models; to nie wyklucza potomnych procesów ani innych mechanizmów spoza tego audytu.

Odczyt HKCU/HKLM Command Processor AutoRun w sandboxie nie zwrócił wartości; nie odczytano treści ani sekretów. Brak wartości w takim odczycie nie jest niezależną pełną weryfikacją rejestru.

| AC | Status | Dowód | Następne |
| --- | --- | --- | --- |
| CONSOLE-03: źródło czterech wywołań CMD przy starcie | PASS | Cztery powyższe wpisy i bootstrap source | Sprawdzić widoczność oraz potomków konkretnego probe |
| CONSOLE-01: eliminacja krótkich okien | UNVERIFIED | windowsHide=true nie dowodzi braku potomnych konsol | Pomiar z walidacją czułości lub kontrolowane porównanie ścieżek |

Nie zmieniano auto-detekcji ani uprawnień. Brak wywołań live LLM w tym podejściu. Cel pozostaje otwarty.
