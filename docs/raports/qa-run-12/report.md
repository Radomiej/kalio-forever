# QA run 12 — Devin SWE-2, Kalio MCP i Home Site

**Data:** 2026-09-27 (Europe/Warsaw)  
**Werdykt:** `CONDITIONAL` dla lokalnego QA. Kalio i świeży odczyt narzędzia przez Devin działają; strona Home Site renderuje się w lokalnym preview. Nie zamknięto ponownego, świeżego testu zapisu/terminala, naprawy builda Playwright Orchestratora ani produkcji.

**Trwały handoff:** [Notion Agent Note](https://app.notion.com/p/3e8c847d1825810bb5f5eafb51abf3e3?pvs=204). Status RAD-114 pozostaje `In Progress`; próba komentarza z dowodami QA została zablokowana przez kontrolę bezpieczeństwa Linear i nie była ponawiana.

## Środowisko i ograniczenia

- Kalio stable QA: UI `http://localhost:5288/`, API `http://127.0.0.1:3316/`; profil `qa`, baza i workspace w `C:\Users\Radomiej\AppData\Local\kalio-forever-qa`.
- Świeży `pnpm qa:status`: `running`, backend/frontend health `ok`, efektywny provider `mock/mock`, source `env`.
- Przeglądarka Chrome MCP: lokalny preview Home Site `http://127.0.0.1:4173/`; projekt `E:/Projekty/home-site`.
- Kalio UI pokazało Devin CLI online, ACP dostępne, 634 wykryte modele (m.in. `swe-2`, `swe-2-high`, `swe-2-medium`, `swe-2-max`). W świeżej sesji wybrano `swe-2-high`; status rozliczenia/darmowego limitu nie został niezależnie potwierdzony.
- Ustawienia Integrations: Kalio MCP bridge włączony; natywne narzędzia Devina filesystem/web/terminal wyłączone; zewnętrzne Codex MCP zablokowane.
- Playwright Orchestrator MCP odpowiada pod `http://127.0.0.1:3333/mcp`; Kalio UI pokazało 26 dozwolonych narzędzi. W widocznej allowliście nie ma narzędzi do cookies/storage, eval/code ani upload/download.
- Provider Kalio pozostał mock. Nie wykonano płatnego providera, deploymentu ani produkcyjnego testu.

## Macierz akceptacji

| AC | Status | Dowód | Granica / następny krok |
|---|---|---|---|
| AC-01 — stałe QA działa na przypisanych portach i danych | PASS | Świeży `pnpm qa:status`: backend 3316 i frontend 5288 `ok`; AppData QA; `mock/mock`, `source=env`. | Brak dla lokalnego QA. |
| AC-02 — Playwright Orchestrator MCP jest podłączony i ograniczony allowlistą | PASS | Kalio UI: `http://127.0.0.1:3333/mcp`, 26 tools. | Build źródłowego serwera nadal kończy się błędem — patrz finding P2. |
| AC-03 — Devin używa narzędzi Kalio, a natywne kategorie pozostają wyłączone | PASS | Integrations UI: Kalio bridge on, Devin filesystem/web/terminal off, Codex external MCP blocked; świeży run `Devin CLI · swe-2-high`. | Nie jest to dowód, że sam Devin nie ma innych funkcji poza ustawieniami widocznymi w Kalio. |
| AC-04 — świeże wywołanie Devin → Kalio MCP | PASS | Jedno zakończone `fs_list` dla `E:/Projekty/home-site/src`: `App.jsx` (10919 B), `main.jsx` (237 B), `styles.css` (11700 B), `omitted=0`. | W tej próbie nie wykonywano zapisu ani terminala. |
| AC-05 — `fs_read`, `fs_write` i terminal przez osobne HITL | PARTIAL | Poprzednie lokalne przebiegi: `fs_read`/`fs_write` i zatwierdzone `terminal_spawn` instalacji/builda są opisane w [run 7](../qa-run-7/report.md), [run 8](../qa-run-8/report.md) i [run 11](../qa-run-11/report.md). | Run 12 nie powtórzył tych trzech operacji; każde write i terminal nadal wymaga osobnej zgody. |
| AC-06 — MCP nie może ominąć ludzkiego HITL przez globalną politykę | PASS dla regresji API | Zmiana rozdziela jawne zatwierdzenie MCP od auto-approve/unattended fallback. RED→GREEN; 6 plików testowych, 95 testów PASS. | Pełny przeklik każdego rodzaju zatwierdzenia w przeglądarce nie był celem tej iteracji. |
| AC-07 — wygenerowana strona działa w przeglądarce | PASS dla lokalnego desktop preview | Chrome MCP pokazał kompletną stronę NEXORA; drzewo dostępności zawiera nav, hero, usługi, projekty, testimonial, formularz i footer. Zrzut: [01 — Home Site](assets/01-home-site-after-fix-desktop.png). | Tylko desktopowy localhost preview; mobile, klawiatura i pełny WCAG audit nie były testowane w tym runie. |
| AC-08 — źródło Playwright MCP buduje się bez pętli `cmd.exe` | BLOCKED / containment PASS | Logi pokazały `npm run dev:server` → build → `tsc` → `TS2688: Cannot find type definition file for 'node'` → exit 2 i watchdog retry; historyczny `restartCount=427`. Teraz serwer działa, `restartOnExit=false`. | Brak poprawki w zewnętrznym repo; restart-loop zatrzymany, ale autostart wciąż włączony i trwały samonaprawiający start nieudowodniony. |
| AC-09 — produkcja | N/A | Wyłącznie lokalny QA/mock i preview. | Nie wdrażano. |

## Zmiany i weryfikacja

- `ToolConfirmationService` otrzymał ścieżkę `humanOnly`, która nie uznaje globalnego auto-approve i nie używa unattended fallback po timeout.
- `ToolDispatchService` wymaga jawnego potwierdzenia użytkownika dla zewnętrznych wywołań MCP, niezależnie od `requiresConfirmation` w metadanych. Po akceptacji dispatch idzie przez istniejącą ścieżkę `dispatchApproved`.
- Dodano regresje dla MCP przy globalnym bypassie oraz fixture `domain: 'mcp'` dla bridge; istniejące testy ścieżki po akceptacji dostosowano, by testowały właściwą granicę.
- Z `.kalio/config.toml` usunięto nieużywany `default_tools_approval_mode = "prompt"`; allowlista pozostaje kanonicznym ograniczeniem narzędzi.
- Targeted test gate: `pnpm --filter kalio-api exec vitest run src/config/kalio-config.service.spec.ts src/modules/mcp/mcp-runtime.utils.spec.ts src/modules/mcp/mcp.service.spec.ts src/modules/mcp/mcp-projections.spec.ts src/modules/mcp-bridge/kalio-mcp-bridge.service.spec.ts src/modules/chat/__tests__/tool-dispatch.service.spec.ts` — **6 plików, 95/95 testów PASS**.
- `pnpm qa:rebuild` — backend TypeScript/SWC i frontend Vite build PASS; frontend zgłosił istniejące ostrzeżenie o dużym chunku.
- Po rebuildzie świeży `pnpm qa:status` potwierdził działające PID-y 9920/23304, porty 3316/5288 i health `ok`.
- Screenshot `01-home-site-after-fix-desktop.png`: 1425×3972; SHA-256 `cb8d7ceb677db5eccd2858f93f390d28ac0a066beb5bc1cda2e3315549b1e925`.
- Luna Max review wykrył pierwotną lukę w ścieżce HITL MCP i wskazał potrzebne regresje; po poprawce te testy przeszły. Agent Playwright nie miał dostępu do zewnętrznego checkoutu, więc nie zmienił jego źródeł.

## Findings i pozostałe granice

| Priority | Finding | Impact | Evidence | Resolution |
|---|---|---|---|---|
| P2 | Build Playwright Orchestratora nie znajduje typów Node; watchdog wcześniej ponawiał build co 2 s. | Mógł generować serię procesów `cmd.exe`/`npm` po restarcie. | `TS2688`, exit 2, log retry i `restartCount=427`. Bieżący proces nasłuchuje na 3333 przy `restartOnExit=false`. | W bieżącym checkoutcie nie można zmienić zewnętrznego repo. Naprawić zależność/lock/install w repo Playwright, zweryfikować czysty build, potem świadomie przywrócić watchdog. |
| P2 | Osobny MCP Data Analyst nie odpowiada w Kalio. | Ten serwer nie jest dostępny do QA. | UI MCP: `http://127.0.0.1:3000/mcp fetch failed`. | Osobna diagnostyka; nie blokuje potwierdzonego Playwright MCP ani świeżego `fs_list`. |
| P2 | Dla `fs_read`, `fs_write` i terminala brak świeżej powtórki w run 12. | Obecna próba dowodzi listowania, nie pełnego read/write/build flow. | Run 12 wykonał tylko `fs_list`; starsze dowody pozostają w run 7/8/11. | Kolejna próba powinna używać tego samego projektu QA i odrębnych approval dla read/write/terminal. |
| P3 | Projekt Home Site miał wcześniej 2 zgłoszenia z `npm audit` (1 medium, 1 high); nie triage'owano ich w run 12. | Nieznany zakres/osiągalność podatnych zależności. | Zapis poprzedniego install w run 11; brak świeżego audytu. | Osobny read-only audit; bez `npm audit fix` bez jawnego zakresu. |

Autostart usługi Playwright pozostaje `true`, ale watchdog restart-on-exit jest wyłączony; zatem bieżące containment ogranicza pętlę, nie usuwa przyczyny. Produkcja, mobile, klawiatura/WCAG i naprawa zewnętrznego repo nie są potwierdzone.
