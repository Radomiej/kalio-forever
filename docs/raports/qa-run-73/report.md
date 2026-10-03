# QA 73 — pełna bramka lokalna i lint

2026-10-03. Checkout `C:\Users\Radomiej\.codex\worktrees\5a7e\kalio-forever`, branch `codex/kalio-provider-runtime-ux`, baza `fae4d3f`. Wcześniejszy dirty worktree zachowany. System Node22.15.0 na PATH, polecenia poza sandboxem. Nie restartowano stałego QA, nie uruchamiano inferencji, nie zmieniano Home Site.

| AC | Status | Dowód | Granica |
|---|---|---|---|
| UX-11 pełna główna bramka testów | PASS | `node scripts/run-test-gate.mjs`, exit0 | Nie pełne browser E2E ani proof produkcji |
| Testy frontend | PASS | 206 plików, 1821 testów, 111.03 s | Aktualny dirty checkout |
| Testy backend | PASS | 267 plików PASS, 1 skipped; 2875 testów PASS, 3 skipped; 111.45 s | Pominiętych testów nie liczymy jako PASS |
| Testy launchera | PASS | 14/14, 30.60 s | Izolowane testowe procesy; nie reset stałego QA |
| API/web typecheck | PASS | `corepack pnpm -r --filter=kalio-api --filter=kalio-web run typecheck`, exit0 | Przed poniższą semantycznie równoważną zmianą regex |
| Web lint | PASS z ostrzeżeniami | Osobny `eslint src --ext .ts,.tsx`, exit0; 0 errors, 24 hook warnings | Ostrzeżenia nie zostały usunięte |
| Backend lint | FAIL | Workspace lint exit1, 12 errors przed poprawką parsera | Nie zamknięto pełnego lint |
| Parser katalogu MCP po poprawce | PASS | Focused eslint exit0, Vitest11/11 | Nie ponowny pełny build/deploy |

## Minimalna poprawka

`devin-cli-mcp-catalog.ts`: wielokrotne literalne spacje zapisano jako ` {2}` i ` {4}`, zgodnie z ESLint `no-regex-spaces`. Nie użyto `\s`, nie poluzowano gramatyki ani wymagań: CLI nadal wymaga dokładnie dwóch spacji przy wierszu i disabled suffix oraz czterech przy endpointach. Focused tests zachowały 11/11 PASS.

Pierwsza próba focused eslint podała nieistniejący package-local entrypoint i zakończyła ten subcommand `MODULE_NOT_FOUND`; późniejszy Vitest w tej samej komendzie dał exit0, więc nie uznano tego za dowód lint. Powtórzenie przez dostępny `corepack pnpm exec eslint <plik>` dało prawdziwy exit0.

## Pozostałe błędy backend lint

Przed poprawką parsera workspace zgłosił też:

- claude-agent-sdk.llm-source.ts: unused SDKMessage/ExecutionProfile.
- devin-api.llm-source.ts: unused ExecutionProfile, useless assignment finalSession.
- devin-native-tools.ts: unused escapeRegExp.
- subagent-runtime.service.ts: unused SessionRuntimeContext, prefer-const promptMessageId.
- managed-vscode-process.ts: dwa unnecessary escape.
- project-ide-runtime.manager.ts: assignment to exception parameter.

Nie wprowadzono zbiorczego `--fix` ani zmian w tych plikach. Pozostałe dziesięć wcześniejszych findings wymaga przeglądu zakresu/ownership i ponownego lint; nie deklarujemy zweryfikowanego nowego count po pełnym rerun.

Duże outputy root testów były częściowo ucięte; końcowe podsumowania aplikacji i terminalny exit0 odebrano. Nie wyciągamy dodatkowych twierdzeń z niewidocznych fragmentów logów. Pierwsze etapy root gate zbudowały types/sdk i potwierdziły repo preflight.

Werdykt całego zakresu: **UNVERIFIED**. [P2] Do zamknięcia wymagane: backend lint, nowe buildy i deploy QA odpowiadający reviewed source, pozostała macierz UX/CTO i ciągły pomiar CMD. Zielone testy nie zamykają całego celu.
