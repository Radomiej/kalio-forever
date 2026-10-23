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
