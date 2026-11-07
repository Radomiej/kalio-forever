# Post-MVP Plans

Ten dokument zbiera kierunki rozwoju celowo wyjęte z dokumentacji MVP/as-built.

## 1. CLI As Agent

- CLI agent ma docelowo stać się pełnoprawnym uczestnikiem runtime, a nie tylko zewnętrznym adapterem procesowym do zadań kodowych.
- Plan obejmuje model `CLI as agent` z mechanizmem wywoływania zatwierdzonych narzędzi Kalio przez wspólną warstwę policy/HITL/audytu.
- Child session lineage, streaming, stop/resume i ślad wykonania powinny pozostać zgodne z resztą runtime.

## 2. Jedno wejście wykonawcze

- Produktowe wykonanie powinno docelowo przejść przez jedno wejście zgodne z modułem chat/LLM.
- Warstwa "Architecture" powinna pozostać edytorem workflow i powierzchnią authoring/debug, a nie osobnym modelem wykonania produktu.
- Docelowe profile uruchomienia to zwykły run oraz debug run, ze wspólnymi trace'ami, projekcjami i semantyką stop.

## 3. Uproszczenie klasyfikacji sesji/runtime

- Obecny runtime używa jednocześnie utrwalonego `ChatSession.kind` oraz bogatszego `SessionRuntimeContext.runtimeKind`.
- Post-MVP warto ocenić jeden kanoniczny model klasyfikacji albo twardszą regułę wyprowadzania jednego poziomu z drugiego.
- Uproszczenie nie może zepsuć kompatybilności storage, projekcji FE, polityk narzędzi ani audytu historycznego.

## 4. Observability poza lokalnym UI

- MVP zakłada lokalne Observability UI i lokalny audyt runtime.
- Eksport logów do zewnętrznych systemów obserwowalności, append-only storage albo centralnego logowania pozostaje osobnym torem post-MVP.

## 5. Przeglądarka agenta i dowody wizualne — propozycja 2026-11-07

- Zachować domyślny tryb izolowanych sesji Playwright, rozdzielonych między agentami. Snapshot DOM, zapis PNG oraz odczyt pikseli przez model to trzy osobne możliwości; raport QA ma jasno wskazywać, które faktycznie wykonał.
- Obecne `take_snapshot` zwraca metadane i ścieżkę PNG. Samo dopisanie narzędzia do allowlisty nie przekazuje obrazu do modelu. Przed uznaniem audytu wizualnego za gotowy potrzebne są kontrolowane przekazanie obrazu do modelu oraz dowód jego odczytu, wraz z trwałym artefaktem widocznym w Kalio.
- Dodać jawnie wybierany tryb połączenia z przeglądarką użytkownika: dla Chrome/Edge przez istniejące Chrome DevTools MCP lub CDP, z widoczną zgodą, zakresem sesji i przyciskiem rozłączenia. Nie przejmować domyślnie profilu użytkownika.
- Firefox wymaga osobnego adaptera WebDriver BiDi albo rozszerzenia; nie oferować dla niego opcji CDP jako działającej integracji.
- Weryfikacja: agent sam otwiera testową aplikację, wykonuje akcje, zapisuje PNG, otrzymuje rzeczywiste dane obrazu, rozpoznaje kontrolowany szczegół wizualny i zamyka swoją sesję. Oddzielnie sprawdzić odrzucenie zgody, utratę połączenia, anulowanie i izolację równoległych agentów.
- Źródła do projektu adaptera: [Chrome DevTools MCP](https://developer.chrome.com/docs/devtools/agents/get-started/configuration), [Playwright CDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp), [Firefox Remote Protocols](https://firefox-source-docs.mozilla.org/remote/index.html). To plan, nie deklaracja wdrożonej obsługi.
