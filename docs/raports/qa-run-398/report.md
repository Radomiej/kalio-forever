# QA398 — krótkotrwałe okna konsoli podczas rozruchu

Data: 2026-10-04. Zakres: diagnostyka bez restartu, zmiany providerów i nowych wywołań LLM.

## Zgłoszenie użytkownika

Przy rozruchu nadal czasem pojawia się na chwilę około 4–5 okien konsoli. Znikają w ciągu kilku sekund. To korekta dotychczasowego dowodu braku okien, nie nowy zakres.

## Wynik: UNVERIFIED

| AC | Status | Dowód | Pozostało |
| --- | --- | --- | --- |
| WIN-01: wychwycić krótkotrwałe widoczne konsole | UNVERIFIED | Dotychczasowy obserwator używa SetWinEventHook i pętli komunikatów co 10 ms; autotest tworzy niewidoczną kontrolkę Static | Sprawdzić czułość na rzeczywistą krótkotrwałą konsolę; autotest Static tego nie dowodzi |
| WIN-02: przypisać okna do procesu i fazy startu | UNVERIFIED | Inspekcja uruchomień przez ast-grep i odczyt launchera | Powiązać czas zdarzenia okna/PID z procesem potomnym i dokładnym sposobem rozruchu |
| WIN-03: zachować dostępność QA i ustawienia | PASS w zakresie tej diagnostyki | http://localhost:5288/ zwraca HTTP 200; PID 10288 i 59376 istnieją jako node | Nie dowodzi to komunikacji z agentem; nie wykonywano restartu ani zapisu konfiguracji |

## Sprawdzone źródła

- `scripts/stack-manager.mjs`: backend oraz frontend mają `windowsHide: true`.
- `devin-cli-acp.host.ts`: bezpośredni spawn ma `shell: false` i `windowsHide: true`.
- `codex-app-server-process.ts`: oba znalezione wywołania spawn mają `windowsHide: true`.
- `terminal.service.ts`, `cli-agent.service.ts`, `cli-agent-probe.service.ts` oraz `cli-agent-process-kill.ts`: znalezione wywołania również ukrywają okno.
- Installer deklaruje ukryte uruchomienie stabilnego launchera. Nie sprawdzono efektywnej konfiguracji zainstalowanego autostartu.

Obecność tych opcji nie dowodzi, że zewnętrzny agent lub inny launcher nie tworzy własnych procesów potomnych z widocznymi oknami.

## Ograniczenia pomiaru

Obserwator odczytuje klasę okna dopiero przy dostarczeniu callbacku. Jeśli okno już nie istnieje, odczyt może nie rozpoznać klasy i filtr odrzuci zdarzenie. Widoczność także jest próbkowana przy callbacku, nie w chwili oryginalnego zdarzenia. Jest to możliwa luka pomiaru, nie ustalona przyczyna zgłoszonych okien. Dotychczasowe zero zdarzeń nie zamyka WIN-01 ani WIN-02. Wcześniejsza odmowa dostępu do WMI nie jest dowodem braku procesów.

## Następny krok

[P2] Przed uznaniem braku spamu za potwierdzony ustalić, czy zgłoszenie dotyczy logowania do Windows, startu QA, czy startu hosta Devina. Następnie wykonać jeden zsynchronizowany pomiar tej fazy, z obserwatorem gotowym przed akcją i zweryfikowaną czułością na krótkotrwałe konsole. Nie naprawiać launchera na podstawie samej hipotezy i nie przypisywać winy Devinowi bez PID/czasu.

Nie zmieniono kodu aplikacji, nie wykonano deployu ani restartu. Brak nowego testu UI i screenshotu: zgłoszone okna nie zostały w tym podejściu odtworzone. Raport jest lokalny; brak synchronizacji z Linear/Notion.
