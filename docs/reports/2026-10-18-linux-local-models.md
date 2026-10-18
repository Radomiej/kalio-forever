# Kalio: Linux, lokalne modele i narzędzia — 18 października 2026

## Stan porównania modeli

Zainstalowano Ollamę 0.40.6 w trybie CPU. Suma SHA-256 archiwum zgadza się
z opublikowanym `sha256sum.txt` wydania:
`c164ab8b1b28e2a247c29719b8e404c423c5b83ae64c3ab4e59d50c7ff7fc5e0`.
Serwer odpowiada na `/api/version` i `/api/tags`. Maszyna ma limit 4 CPU,
32 GiB pamięci i nie ma GPU. Modele mają pracować kolejno, po jednym w pamięci.

| Model | Pobranie wag | Tool calling po angielsku | Tool calling po polsku | Budowa projektu przez model |
|---|---|---|---|---|
| Qwen3 4B (`qwen3:4b`) | zablokowane | nie wykonano | nie wykonano | nie wykonano |
| Qwen2.5 3B (`qwen2.5:3b`) | zablokowane | nie wykonano | nie wykonano | nie wykonano |
| Llama 3.2 3B (`llama3.2:3b`) | zablokowane | nie wykonano | nie wykonano | nie wykonano |

Każda próba `/api/pull` otrzymała `Forbidden` podczas połączenia z
`registry.ollama.ai`. Wagi nie zostały zainstalowane. Nie ma podstaw do
rankingu jakości ani wskazania zwycięzcy. Zapisano wymagane domeny w szkicu
konfiguracji środowiska; szkic sam nie zmienia aktywnej polityki sieciowej.
Po zapisaniu ustawień należy ponowić pobieranie. Jeżeli rejestr przekieruje
plik do dodatkowego hosta blob storage, trzeba dopuścić jego dokładną domenę.

Przygotowany `scripts/local-model-benchmark.mjs` wykonuje po sześć przypadków
na model: narzędzie arytmetyczne, zapis/odczyt tekstu „Zażółć gęślą jaźń”
i projekt Node, każdy z poleceniem angielskim oraz polskim. Zachowuje faktyczne
tool calls, argumenty, odpowiedzi, czasy i porażki. Testy projektu muszą się
rzeczywiście wykonać; dodatkowe, niezmienialne przez model asercje sprawdzają
poprawność kodu niezależnie od testów napisanych przez model. Wyniki `blocked`
nie są zaliczane jako sukces. Sam harness ma testy pozytywne i negatywne.

To benchmark protokołu Ollamy i ograniczonych narzędzi testowych. Po wyborze
modelu potrzebny jest jeszcze test Agenta przez Kalio i jego UI. Żaden klucz
płatnego dostawcy nie jest potrzebny do lokalnej Ollamy.

## Instalacja produkcyjna z GitHuba

Rzeczywiste archiwum `kalio-runtime-1.0.2-linux-x64.tar.gz` pobrano z wydania
GitHuba, sprawdzono SHA-256 i rozmiar według manifestu, a następnie zainstalowano
przez `scripts/install-release.sh --version 1.0.2`. Manifest tego wydania jest
niepodpisany; nie przedstawiamy weryfikacji SHA-256 jako podpisu wydawcy.

Sprawdzono API, SQLite, wbudowany HTML, `doctor`, tworzenie sesji, zapis i odczyt
plików przez VFS. Mały projekt Node z tych plików przeszedł rzeczywisty test
`node:test`. Jest to deterministyczny projekt kontrolny utworzony przez API,
nie projekt wygenerowany przez model.

Test oryginalnego pakietu wykrył pozostawianie `.runtime.lock` po SIGTERM do CLI.
Zbudowano więc osobny pakiet kandydujący z bieżącego checkoutu, o wersji
repozytorium 1.0.1. Nie jest on opublikowanym wydaniem ani aktualizacją 1.0.2.
Pakiet kandydujący przeszedł wszystkie kroki smoke testu, w tym poprawne
zatrzymanie i restart z zachowaniem danych.

Naprawiono:

- stabilny launcher powiązany z niestandardowym katalogiem instalacji, także
  zawierającym spacje; launcher śledzi `current.json`;
- sprawdzanie SHA-256 i rozmiaru pobranego archiwum; podpisane manifesty wymagają
  zaufanego klucza i poprawnej weryfikacji Ed25519;
- zachowanie konfiguracji i danych przy reinstalacji oraz blokowanie podmiany
  działającego runtime;
- przekazywanie SIGINT/SIGTERM do serwera i zwalnianie blokady runtime;
- wybór archiwum Linuksa w updaterze, separator ścieżek i przekazywanie loggera;
- sprawdzanie własności procesu przed `update --force` na Linuksie;
- budowanie pakietu z przypiętym pnpm i wersjami bezpośrednich zależności
  zainstalowanych w checkoutcie. Poprzedni etap ponownej instalacji przełączał
  menedżer na pnpm 12 i dobierał nowsze zależności, mimo pnpm 9 w repozytorium.

Zmiany w CLI/updaterze wymagają wydania nowego archiwum. Poprawiony bootstrap
nie zmienia automatycznie kodu wewnątrz istniejącego opublikowanego 1.0.2.
Wariant Bun i instalatory desktopowe nie zostały objęte nowym testem runtime.

## Narzędzia i wyniki kontroli

| Zakres | Wynik i granice dowodu |
|---|---|
| Rejestr narzędzi | 62 narzędzia, 62 poprawne schematy JSON Schema |
| VFS i pliki | realny zapis/odczyt przez produkcyjne API oraz test narzędzia `vfs_write` z potwierdzeniem i anulowaniem w UI |
| Persony i skills | CRUD w testach API/przeglądarkowych |
| RA-App | katalog, renderowanie i przejście do czatu w Chromium |
| KV, terminal, subagenci i pozostałe narzędzia | testy jednostkowe/integracyjne; zależności części testów są zastępowane mockami |
| Web search, obrazy, zewnętrzne CLI, IDE | brak pełnego testu live; wymagają usług lub poświadczeń |
| Rzeczywisty lokalny LLM | zablokowany brakującymi wagami, bez pozorowanego wyniku mock |

- Pełne testy backendu: 2703 poprawne, 1 pominięty.
- Pełne testy frontendu: 1743 poprawne.
- Kontrakty: 16 poprawnych.
- Dodatkowe regresje: instalator, podpisy, updater, CLI, Corepack, pakowanie
  zależności i harness modeli — poprawne.
- Chromium: 18 poprawnych testów streamingu, HITL, VFS, person, skills i RA-App;
  dostawca LLM w tych testach: `mock`.
- Backend coverage: 85,00% linii, 80,39% gałęzi; progi spełnione.
- Frontend coverage: 86,81% linii, 79,09% gałęzi; progi spełnione.
- Build i typecheck: poprawne. Lint: 0 błędów, 24 wcześniejsze ostrzeżenia.
- `actionlint` obu zmienionych workflow: poprawny. Bash syntax checks: poprawne.
- `audit:report`: kod wyjścia 0; raport wskazuje także istniejący sygnał
  `silent-catch` w `CodeIntelligenceQuickTrust.tsx:62` i dług architektoniczny.
  Nie jest to zweryfikowany nowy problem bezpieczeństwa ani zmiana tego PR.

Nie twierdzimy, że wszystkie 62 narzędzia przeszły test z rzeczywistym modelem.
Pokrycie kodu i poprawność schematów nie zastępują takiego testu.

## CI i dalsze kroki

Dodano testy regresyjne Linuksa do CI oraz obowiązkowy job `linux-runtime`
budujący rzeczywiste archiwum, instalujący je i sprawdzający start, VFS,
projekt Node, zatrzymanie i trwałość danych. Workflow wydania sprawdza pakiet
Node przed uploadem. Ciężkie modele nie są pobierane przy każdym PR.

Git read oraz próbny push działają. Aktywna polityka blokuje `api.github.com`,
więc lokalne testy i walidacja YAML nie są potwierdzeniem ukończenia GitHub
Actions ani utworzenia pull requesta. Merge wymaga PR i poprawnych zdalnych
kontroli; nie należy zastępować ich lokalnym raportem.

W środowisku chmurowym surowe dowody są zapisane w
`/workspace/kalio-linux-evidence`, wyniki prób modeli w
`/workspace/local-models/benchmark/results.json`, a archiwum kandydujące i
receipt smoke testu w `/workspace/linux-candidate`. Projekt kontrolny jest
zachowany w `/workspace/kalio-demo-project`.
