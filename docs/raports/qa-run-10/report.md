# QA run 10 — restart stałego QA po reboocie

**Data:** 2026-09-26, Europe/Warsaw. **Werdykt:** `CONDITIONAL` dla wznowienia środowiska; pełny test wygenerowanej strony pozostaje `NO-GO` po nieudanym buildzie z run 9.

## Środowisko i zakres

- Checkout: `C:\Users\Radomiej\.codex\worktrees\5a7e\kalio-forever`, `HEAD c436ca4`, detached i już zmodyfikowany przed tą próbą. Nie resetowano ani nie czyszczono plików.
- Stały QA: `http://localhost:5288/`, API `http://127.0.0.1:3316/`, profil `qa`, istniejące dane `C:\Users\Radomiej\AppData\Local\kalio-forever-qa` (`kalio-qa.db`, `workspaces`).
- Serwer agentów: `mcp-cli-agents`, REST `3414`, MCP `3413`; osobny proces UI `5534`. `autostart=false` pozostawiono bez zmian. Odrębny dev stack Kalio (`3016/5188`) pozostawiono wyłączony; nie jest wymagany dla stałego QA.
- Przeglądarka: osobna sesja Playwright Chromium headless, `1280×720`. Narzędzie do sterowania otwartą kartą in-app browser nie uruchomiło się przez `windows sandbox failed: helper_unknown_error: apply deny-read ACLs` — nie jest to błąd Kalio.
- Poprzedni cel projektu: `E:\Projekty\home-site`, rozmowa `Devin SWE-2 QA`, model `swe-2-high`. W tej próbie nie wysłano nowego promptu, nie uruchomiono agenta ani terminala w projekcie.

## Przebieg

1. Przed startem `pnpm qa:status` wykazał `partial/stale state`: stare PID-y 13864/13400, brak nasłuchu na 3316/5288. Nie kończono żadnego obcego procesu.
2. Uruchomiono zarejestrowaną usługę `mcp-cli-agents`; `http://127.0.0.1:3414/api/health` zwróciło 200 i `status=ok`, `activeTurns=0`.
3. `pnpm qa` przy systemowym Node poza sandboxem przebudowało API (638 plików, TypeScript 0 błędów) i web (3104 moduły), po czym uruchomiło PID 43780/39624. Build web zgłosił tylko ostrzeżenie o chunku ~2,1 MB.
4. `pnpm qa:status`: `running`, oba health `ok`, provider `mock`, model `mock`, source `env`. `GET /api/health`, `/api/llm/config`, UI, `/runtime-config.js` i handshake Socket.IO odpowiedziały 200; frontend wskazuje API/WS na `127.0.0.1:3316`.
5. W Chromium UI otworzył Home bez błędów `pageerror`; Talk pokazał 7 zachowanych rozmów i grupę `Home Site 5`. Otwarta rozmowa Devina nadal zawiera wcześniejszy wynik `npm install` kod 0 oraz `npm run build` kod 1 z brakiem `vite`. Nie powtarzano tych poleceń.
6. Settings → Integrations: Devin `devin.exe` Online, Logged in, ACP available, 634 discovered models, Kalio MCP bridge enabled; natywne przełączniki filesystem/web/terminal pozostały wyłączone. Ta sama karta pokazała Codex `Disconnected` i `Not connected`.
7. Mimo że rejestr usługi `mcp-cli-agents` deklaruje port UI `5534`, po `dev:server` port odmawiał połączenia. `package.json` rozdziela `dev:server` od frontendu `dev:ui`. Uruchomiono jeden dodatkowy proces `npm.cmd run dev --workspace apps/local-ui -- --port 5534 --strictPort`; potem `/` i `/api/health` przez proxy na 5534 zwróciły 200. Chromium wyrenderowało konsolę agentów bez błędów `pageerror`. Na screenshocie pola input, w tym token, są zamaskowane. Proces UI nie należy do zarejestrowanej usługi i nie ma autostartu.

Zrzuty ekranu:

- [01 — zachowana rozmowa Home Site w Talk](assets/01-talk-home-site.png)
- [02 — status integracji Devin](assets/02-integrations.png)
- [03 — konsola agentów na 5534, pola input zamaskowane](assets/03-agent-ui.png)

## Macierz akceptacji

| AC / PIT | Status | Dowód | Pozostało |
|---|---|---|---|
| AC-01 — stały QA na własnych portach/danych | PASS | `qa:status` running, 3316/5288, baza i workspace w AppData; HTTP 200 | Brak w zakresie restartu |
| AC-02 — provider nie zmienił się na płatny/live | PASS | `/api/llm/config`: `mock/mock`, source `env` | Brak |
| AC-03 — control plane agentów | PASS | `mcp-cli-agents` running, REST/MCP 3414/3413; osobne UI/proxy 5534 HTTP 200 i screenshot 03 | UI 5534 wymaga osobnego startu po reboocie |
| AC-04 / PIT-05 — UI i trwałe rozmowy po świeżym otwarciu | PASS | Chromium 1280×720: Home, Talk, 7 rozmów, Home Site 5; screenshot 01 | Nie powtórzono stanu już otwartej karty sprzed restartu |
| AC-05 — host Devin po restarcie | PASS | Settings → Integrations: Online, ACP available, 634 modeli, MCP bridge enabled; screenshot 02 | Nowego wywołania Devina nie wykonywano |
| AC-06 — host Codex w Kalio | FAIL | Drzewo dostępności Settings → Integrations: Disconnected / Not connected; osobna konsola mcp-cli-agents pokazuje Codex CLI Installed/Authenticated | Wyjaśnić różnicę między integracjami; status Kalio jest poniżej kadru screenshotu 02 |
| AC-07 / PIT-09 — build i preview `home-site` | BLOCKED | Zachowany wynik run 9: build kod 1, brak `vite`; brak nowego builda | DevDependencies, build, preview oraz mobile/keyboard/WCAG nie były częścią restartu |

## Findings

| Priority | Finding or action | Impact | Evidence | Resolution |
|---|---|---|---|---|
| P2 | Host Codex pokazuje `Disconnected` po restarcie. | Funkcje Codex w Kalio nie są potwierdzone. | Drzewo dostępności Settings → Integrations; screenshot 02 obejmuje tylko kartę Devina. | Zdiagnozować osobno; nie mylić z działającym `mcp-cli-agents`. |
| P2 | Rejestr usługi agentów deklaruje UI 5534, ale komenda `dev:server` nie uruchamia Vite. | Po reboocie samo uruchomienie zarejestrowanej usługi pozostawia UI niedostępne. | 5534 odmówił połączenia przed osobnym startem; po nim `/` i `/api/health` = 200; screenshot 03. | Ujednolicić zarządzanie backendem i UI, jeśli wymagane jest wspólne odtwarzanie po restarcie. |
| P2 | Strona `home-site` nadal nie ma potwierdzonego builda ani preview. | Nie można zamknąć pełnego QA projektu. | Zachowana rozmowa i raport run 9: `vite` nieobecny po `npm install`. | Potwierdzić przyczynę pominięcia devDependencies, odbudować i obejrzeć stronę w przeglądarce w kolejnym przebiegu. |
| P3 | Sterowanie otwartą kartą IAB i `node_repl` było niedostępne przez błąd helpera sandboxa. | Nie dało się kontynuować tej samej karty; użyto osobnego Chromium. | `helper_unknown_error: apply deny-read ACLs` dla obu narzędzi. | Naprawić środowisko helpera; nie klasyfikować jako regresji Kalio. |

Nie testowano automatycznej rehydratacji już otwartej karty po restarcie backendu; wcześniejszy finding P2 z run 9 pozostaje otwarty. Nie testowano produkcji. Nie zmieniano ustawienia autostartu, bazy QA ani plików `home-site`.
