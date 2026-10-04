# QA426 — pełna lokalna bramka regresji

Data: 2026-10-05. Checkout codex/kalio-provider-runtime-ux, HEAD fd6bc833 plus zachowane niezacommitowane zmiany. Poza sandboxem, systemowy Node na początku PATH: node scripts/run-test-gate.mjs. Proces 43095 zakończony exit 0.

| Obszar | Status | Dowód | Granica |
| --- | --- | --- | --- |
| Shared types/sdk build i repo preflight | PASS | tsc build Done; preflight all checks passed | Nie jest deployem |
| Backend | PASS | 276 plików PASS, 1 skipped; 2972 testy PASS, 3 skipped; 80.52 s | Live zależności pominięte nie są proven |
| Frontend | PASS | 215 plików, 1889 testów PASS; 79.93 s | Nie zastępuje browser QA |
| Launcher / Playwright wrapper | PASS | 14/14, exit 0 | Są to testy wrappera, nie pełny browser E2E |
| Cała uruchomiona bramka | PASS | exit 0 | Wczesne fragmenty output zostały ucięte; nie deklarujemy pełnego przeglądu każdego logu ani liczby root tests |
| Jev integracja bieżącego checkoutu | UNVERIFIED / brak integracji | merge-base --is-ancestor dla 43beadce i ede6284b zwrócił 1; bounded discovery plików nie zwrócił jev/decision-settings/auto-routing | PR review chronionych shared contracts, integracja i live GOAL-01–09 nadal wymagane |

Nowy monitor measure-process-snapshots ma osobny behavioral PASS w QA423, ale nie jest częścią tej root bramki. Nie resetowano stałego QA ani providerów. Bramka może budować shared artifacts; nie wykonywała deployu aplikacji na QA.

W logach występują ERROR/WARN z negatywnych scenariuszy fixture (np. failure persistence, HITL fallback, image errors). Nie należy utożsamiać ich z błędami żywego QA. Wynik globalny exit 0 i final summaries powyżej są granicą raportowanej regresji; krótkie konsole, Jev oraz pełen cel pozostają otwarte.
