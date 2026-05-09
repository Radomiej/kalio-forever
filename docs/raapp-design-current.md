# RAApp Design - stan aktualny

## TL;DR

- Sa dwa tryby RAApp: `html` i `gui`.
- `html` to pojedynczy dokument `main.html` albo `index.html`, renderowany w iframe przez `srcDoc`.
- `gui` to pojedynczy plik `ui.gui`, kompilowany do JSON `{ nodes, data }` i renderowany przez Reactowy `GuiDslRenderer`.
- RAApp nie zyja w sesyjnym VFS. Sa trzymane jako ZIP-y w katalogu RA-App backendu (`RA_APPS_PATH`, domyslnie `./data/ra-apps`).
- `raapp_create` robi dwie rzeczy naraz: pokazuje blok inline w czacie i zapisuje wygenerowany app do katalogu RA-App.
- Jesli potrzebujesz prawdziwej wielostronicowosci, routingu, zlozonych komponentow albo lokalnego stanu UI, wybieraj `html`, nie `gui`.

## 1. Jak dziala pipeline

### `raapp_create`

`raapp_create` przyjmuje:

- `type: 'html' | 'gui'`
- `content: string`
- `mode: 'display' | 'interactive'`
- opcjonalny `title`

Sciezka wykonania:

1. Backend waliduje blok przez `RAAppService.execute()`.
2. Jesli walidacja przejdzie, backend zapisuje wynik przez `saveGeneratedApp()` jako ZIP w katalogu user RA-App.
3. Do czatu wraca blok `status: 'ready'` z:
   - `type`
   - `mode`
   - `content`
   - `renderedContent`
   - `storedAppId`

To oznacza, ze app jest jednoczesnie:

- widoczny inline w aktualnej sesji jako wynik narzedzia,
- zapisany w katalogu RA-App do pozniejszego uruchamiania.

### `run_raapp`

`run_raapp` bierze zapisany app po jego `id` i odpala go z katalogu RA-App.

- Dla `gui` czyta `ui.gui`, opcjonalnie `systems.yml`, buduje `data.output` i renderuje DSL.
- Dla `html` czyta `main.html` albo `index.html` i oddaje ten HTML do iframe.

## 2. Co backend faktycznie laduje z paczki

RAApp jest paczka ZIP. Backend zna tylko te pliki:

- `meta.yml`
- `main.html` albo `index.html`
- `ui.gui`
- `systems.yml`

W praktyce oznacza to:

- HTML app jest ladowany z jednego pliku HTML.
- GUI app jest ladowany z jednego pliku DSL.
- `systems.yml` jest jedynym wspieranym plikiem pomocniczym po stronie GUI.
- Dodatkowe pliki wrzucone do ZIP-a nie sa normalnie renderowane ani mapowane do URL-i.

To jest bardzo wazne dla pytania o strony i komponenty: obecny loader nie robi bundlowania, nie wystawia zasobow z ZIP-a pod publicznym URL i nie sklada wielu plikow w jedna aplikacje.

## 3. Gdzie to jest przechowywane

Domyslny root to `./data/ra-apps` pod kontrola `RA_APPS_PATH`.

Uklad katalogow:

```text
data/ra-apps/
  core/
  user/
  tmp/
```

Mozliwe sa dwa warianty w `user/`:

### Flat ZIP

Tak zapisywane sa m.in. appki tworzone przez `raapp_create`:

```text
data/ra-apps/user/
  generated-abc12345.zip
  my-upload.zip
```

### Wersjonowana grupa

To layout obslugiwany przez `RAAppVersioningService`:

```text
data/ra-apps/user/<slug>/
  current.zip
  draft.zip
  history/
    1.0.0.zip
    1.1.0.zip
  .manifest.json
```

Frontend pokazuje oba zrodla:

- katalog RA-App z backendu,
- inline appki znalezione w wiadomościach aktualnej sesji.

## 4. Czy to jest widoczne w VFS?

Nie, nie w obecnym modelu.

Obecnie:

- RAApp catalog nie jest podpiety do VFS sesji,
- `RAAppManager` ma parametr `onOpenVFS`, ale jest jawnie nieuzywany,
- wygenerowany design trafia do katalogu RA-App jako ZIP, nie do `sessions/{sessionId}/files/`.

Czyli odpowiedz brzmi:

- nie jako pliki VFS,
- tak jako czesc paczki RAApp na dysku backendu,
- tak jako inline wynik `raapp_create` w historii czatu.

## 5. Ruznica miedzy `raapp html` i `raapp gui`

## `html`

To pelny HTML wrzucony do iframe.

Plusy:

- najlepsza opcja do prawdziwych stron i podstron,
- mozesz zrobic hash router, taby, wizard, modal, wlasny CSS i JS,
- mozesz miec wlasne komponenty JS wewnatrz jednego dokumentu,
- interakcje z czatem ida przez:

```js
window.parent.postMessage({ type: 'kalio_send_message', content: 'wybor usera' }, '*')
```

Ograniczenia:

- renderer czyta tylko jeden dokument HTML,
- dodatkowe pliki z ZIP-a nie sa serwowane jako assets,
- jesli chcesz wiele stron, musza zyc w jednym `main.html` jako client-side routing lub przelaczane widoki,
- brak bezposredniego dostepu do host filesystem i VFS z poziomu iframe.

## `gui`

To lekki DSL kompilowany do drzewa wezlow i renderowany przez `GuiDslRenderer`.

Plusy:

- prosty do generowania z modelu,
- nadaje sie do kart, paneli, CTA, prostych statusow i quizow,
- ma podstawowe bindowanie danych przez `[output.key]`,
- przy `run_raapp` moze korzystac z `systems.yml` i `inputs`.

Ograniczenia:

- to nie jest pelny frontend framework,
- nie ma wbudowanego routera ani wielostronicowosci,
- nie ma runtime importow ani skladania wielu plikow,
- nie ma lokalnego stanu formularzy po stronie renderer-a,
- parser zna wiecej tagow niz renderer realnie obsluguje; wiele nieznanych tagow konczy jako zwykly `div`.

W praktyce `gui` traktuj jako deklaratywny layout DSL, a nie odpowiednik Reacta.

## 6. Jak dodawac nowe strony

### W `html`

Nowe strony dodajesz wewnatrz jednego dokumentu `main.html` lub `index.html`.

Najbezpieczniejsze wzorce:

- hash routing, np. `#/home`, `#/settings`, `#/summary`,
- przelaczanie widokow po stanie JS,
- wizard oparty o `currentStep`.

Czyli "nowa strona" dzisiaj oznacza raczej:

- nowy widok w tym samym HTML,
- nie osobny plik `page-2.html`.

Osobne pliki HTML w ZIP-ie nie sa obecnie automatycznie obslugiwane przez renderer.

### W `gui`

Nie ma first-class pojecia strony.

Mozesz zrobic tylko pseudo-strony, np.:

- kilka sekcji pokazywanych przez `visible`,
- uklad zakladek,
- kilka kart/widokow warunkowych.

To nadal bedzie jeden `ui.gui`, nie routing.

Jesli potrzebujesz prawdziwej nawigacji miedzy stronami, przechodz na `html`.

## 7. Jak tworzyc komponenty w `gui`

W `gui` masz mechanizmy komponentopodobne, ale one dzialaja jako rozwijanie AST przy kompilacji, a nie runtime komponenty.

Glówne mechanizmy:

- `template X { ... }` dla wspolnych propsow,
- `using = "X"` do nalozenia template,
- `types Name { type Card = div { ... } }` dla aliasow komponentowych,
- `block` i `blockoverride` do podstawiania fragmentow.

Bezpieczny minimalny przyklad:

```gui
template Surface {
  class = "rounded-lg border border-base-300 p-4 bg-base-200"
}

types UI {
  type PrimaryButton = button {
    class = "btn btn-primary"
    text = "Continue"
  }

  type Card = div {
    class = "rounded-lg border border-base-300 p-4"
    block body { }
  }
}

div {
  using = "Surface"
  label = { text = "Dashboard" }

  PrimaryButton {
    text = "Open"
    onclick = "open dashboard"
  }
}

Card {
  blockoverride body {
    label = { text = "Card body" }
  }
}
```

Realnie obslugiwane zachowania renderer-a to glownie:

- `window`, `container`, `widget`, `panel`
- `vbox`, `hbox`
- `label`, `span`
- `button`
- `divider`
- `spacer`
- `progressbar`

Wiele innych tagow jest parsowanych, ale renderer nie daje im specjalnego zachowania.

## 8. Jak tworzyc komponenty w `html`

Tutaj po prostu budujesz normalny frontend w jednym pliku HTML:

- funkcje JS,
- komponenty oparte o template stringi,
- CSS classes i utility classes,
- hash router,
- modularyzacja wewnatrz jednego dokumentu.

To jest dzisiaj lepszy wybor dla:

- design systemu,
- wieloekranowych flow,
- zlozonych interakcji,
- niestandardowych widgetow.

## 9. Co z danymi i interakcjami

### GUI

Przy `run_raapp` dla GUI:

- `inputs` sa zamieniane na `data.output`,
- tekst moze bindowac dane jako `[output.name]`,
- `onclick` na buttonie wysyla akcje jako wiadomosc usera do czatu,
- `visible`, `disabled` i `dynamic_class` dzialaja na prostych warunkach tekstowych/liczbowych.

### HTML

Przy `html` nie ma analogicznego mechanizmu wstrzykiwania `inputs` do DOM.

Obecnie HTML path robi praktycznie passthrough: bierze `main.html` i renderuje go w iframe. Jesli HTML ma rozmawiac z czatem, musi sam wywolac `postMessage`.

## 10. Czy moge zaczytywac ten design z FS?

Tak, ale tylko na poziomie katalogu RA-App, nie jako dowolny runtime file access.

### Co jest wspierane

- wrzucenie gotowego ZIP-a do `data/ra-apps/core/` lub `data/ra-apps/user/`,
- upload ZIP-a przez endpoint `/ra-apps/upload`,
- wersjonowane paczki w `data/ra-apps/user/<slug>/current.zip` i `draft.zip`,
- automatyczne ladowanie `meta.yml`, `main.html`/`index.html`, `ui.gui`, `systems.yml`.

### Czego nie ma

- ladowania designu z VFS sesji jako live source dla RAApp catalog,
- bezposredniego `import` z plikow obok `ui.gui`,
- serwowania assetow z ZIP-a pod sciezkami typu `./styles.css` albo `./page2.html`,
- dostepu runtime do host filesystem z poziomu iframe albo GUI renderer-a.

## 11. Najpraktyczniejszy model pracy dzisiaj

Jesli chcesz rozwijac RAApp w kontrolowany sposob, obecnie najbardziej praktyczne sa dwa warianty:

### Wariant A - `html`

1. Trzymaj zrodlo w repo albo poza katalogiem RA-App.
2. Buduj jedna samowystarczalna strone `main.html`.
3. Pakuj do ZIP z `meta.yml`.
4. Wrzucaj do `data/ra-apps/user/` albo uploaduj.

To jest najlepszy wariant dla designu, wielu ekranow i komponentow.

### Wariant B - `gui`

1. Trzymaj jeden `ui.gui`.
2. Opcjonalnie dodaj `systems.yml`, jesli app ma liczyc output na backendzie.
3. Pakuj do ZIP z `meta.yml`.
4. Uruchamiaj przez `run_raapp`.

To ma sens dla prostych narzedzi i malych widokow, nie dla pelnej wielostronicowej aplikacji.

## 12. Odpowiedz na Twoje pytania wprost

### Jak aktualnie dziala RAApp design?

- `html`: jeden dokument HTML renderowany w iframe.
- `gui`: jeden plik DSL kompilowany do JSON i renderowany przez React.

### Jak moge dodawac nowe strony?

- w `html`: jako widoki w tym samym `main.html`, najlepiej hash router,
- w `gui`: tylko jako pseudo-strony w jednym `ui.gui`; brak prawdziwego routingu.

### Jak moge tworzyc komponenty?

- w `html`: normalnie w JS/CSS w ramach jednego dokumentu,
- w `gui`: przez `template`, `types`, `using`, `block`, `blockoverride`, ale to jest mechanizm ograniczony.

### Czy sa widoczne w VFS?

- nie jako pliki sesyjnego VFS,
- tak jako zawartosc paczki RAApp na dysku backendu,
- tak jako wynik toola w historii sesji.

### Czy to rozni sie od aplikacji RAApp HTML?

- tak, bardzo:
- `html` jest pelniejszym runtime UI,
- `gui` jest lekkim DSL z ograniczonym rendererem.

### Czy moge zaczytywac design z FS?

- tak, jako ZIP w katalogu RA-App,
- nie, jako dowolne live pliki z VFS lub host FS podczas renderowania.