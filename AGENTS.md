# AGENTS

Ten plik definiuje zasady dla agentow AI i automatyzacji pracujacych w tym repozytorium.

## Jezyk i zakres

- Z czlowiekiem komunikuj sie po polsku, chyba ze poprosi inaczej.
- Publiczna dokumentacje utrzymuj po polsku; teksty widoczne w UI rozszerzenia zmieniaj tylko na wyrazne zadanie.
- Wprowadzaj zmiany minimalne, zgodne z celem zadania i istniejaca struktura repo.
- Nie cofaj ani nie nadpisuj recznych zmian czlowieka bez wyraznej zgody.
- Przy starcie nowego kontekstu najpierw sprawdz `docs/followups.md`, jesli plik istnieje.

## Format odpowiedzi

- W wypunktowaniach stosuj numeracje glownych punktow jako `1.`, `2.`, `3.`.
- Punktory drugiego poziomu zapisuj jako `a)`, `b)`, `c)`.
- Punktory trzeciego poziomu zapisuj jako liste z kropkami.

## Technologia projektu

- Projekt jest rozszerzeniem Chrome Manifest V3 do Google Meet.
- Kod zrodlowy jest w `src/` i kompiluje sie przez webpack + TypeScript.
- Build trafia do `dist/`; nie edytuj recznie plikow wygenerowanych w `dist/`.
- Entry pointy webpacka sa zdefiniowane w `webpack.config.js`; pliki HTML i `manifest.json` sa kopiowane do `dist/`.
- Przed zmianami w `manifest.json`, `src/background.ts`, `src/offscreen.ts`, `src/popup.ts`, `src/micsetup.ts`, `webpack.config.js` albo HTML rozszerzenia stosuj przewodnik `docs/agent-guides/chrome-extension-ts.md`.
- Uprawnienia Chrome i `host_permissions` zmieniaj tylko wtedy, gdy wymaga tego funkcjonalnosc, i opisz powod w podsumowaniu.
- Przy kazdym generowaniu nowej wtyczki podbijaj `version` w `manifest.json`.
- Przy poprawkach bugow podbijaj ostatnia liczbe wersji, np. `1.1.0` -> `1.1.1`.

## Weryfikacja

- Po zmianach w kodzie lub konfiguracji uruchom `make check`.
- Dla zmian dotykajacych przeplywow przegladarkowych wykonaj tez smoke test z `docs/runbooks/002-smoke-test-po-zmianach.md`.
- Jesli nie da sie uruchomic walidacji, podaj konkretny powod i zakres ryzyka.
- Jesli poprawiasz blad zgloszony w Sentry, po wdrozeniu poprawki zamknij odpowiednie issue w Sentry jako rozwiazane.

## Dokumentacja

- Pliki `AGENTS.md` sa dla agentow i automatyzacji.
- Pliki `README.md` sa dla czlowieka.
- Dokumentacje techniczna trzymaj w `docs/`; indeks i zasady dla tego katalogu sa w `docs/AGENTS.md`.
- Przewodniki agentowe trzymaj w `docs/agent-guides/`; maja zawierac lokalne zasady i linki do zrodel prawdy, bez kopiowania obcych dokumentacji.
- Specyfikacje wiekszych zmian zapisuj w `docs/specs/` przed implementacja, gdy zadanie nie miesci sie w prostej poprawce.
- Runbooki trzymaj w `docs/runbooks/` tylko dla powtarzalnych procedur.
- Unikaj semantycznych duplikatow miedzy `AGENTS.md`, `README.md` i dokumentacja.

## GitHub i proces pracy

- Glowne repozytorium ustalaj z `git remote -v`.
- Domyslny hosting to GitHub.
- Jesli dla operacji istnieje odpowiedni serwer MCP, uzyj go jako pierwszej sciezki pozyskania danych lub wykonania operacji.
- Commit, push i tworzenie Pull Request wykonuj tylko po wyraznej zgodzie czlowieka.
- PR powinien zawierac zakres, sposob weryfikacji, ryzyka oraz informacje o zmianach w uprawnieniach Chrome, jesli takie wystapily.

## Skrot `+PR`

Gdy czlowiek napisze `+PR`, uruchom lokalna procedure pracy z Pull Requestem.

1. Przygotowanie PR
   a) Sprawdz aktualny branch i status repo.
   b) Pokaz czlowiekowi zakres zmian przed commitem.
   c) Jesli sa zmiany, zrob logiczny commit albo kilka malych commitow.
   d) Wypchnij branch.
   e) Utworz Pull Request do glownej galezi projektu jako gotowy do review, nie jako draft.

2. Review Copilota
   a) Popros o review Copilota, jesli repozytorium to obsluguje.
   b) Poczekaj na wynik review.
   c) Jesli Copilot zglosi uwagi, nie wdrazaj ich automatycznie.
   d) Zbierz uwagi Copilota i przedstaw je czlowiekowi do decyzji, najlepiej pojedynczo.
   e) Przy omawianiu uwagi podaj wystarczajacy kontekst techniczny, zeby czlowiek mogl podjac decyzje bez znajomosci detali implementacji.
   f) Wyjasnij, czego uwaga dotyczy, jaki jest praktyczny skutek, jakie sa sensowne opcje i jaka opcje rekomendujesz.
   g) Kazda uwage omow z czlowiekiem przed zmiana w kodzie.
   h) Dopiero po zatwierdzeniu konkretnej uwagi przez czlowieka wprowadz zmiane.

3. Odpowiedzi do review
   a) Na kazda uwage Copilota odpowiedz w watku:
      - `fixed` + krotko co zostalo zmienione
      - `not applying` + krotko dlaczego nie wdrazamy
      - `unclear` + pytanie doprecyzowujace
   b) Nie zostawiaj komentarzy Copilota bez odpowiedzi.
   c) Jesli uwaga jest trade-offem albo moze zmienic zalozenia funkcjonalne, zawsze pytaj czlowieka przed wdrozeniem.

4. Kolejne rundy
   a) Po wdrozeniu zatwierdzonych przez czlowieka poprawek zrob commit i push.
   b) Po odpowiedzeniu na wszystkie uwagi z danej rundy popros Copilota o ponowne review poprawek w tym samym PR.
   c) Po ponowieniu review czekaj do 10 minut na kolejna porcje uwag Copilota.
   d) Ponow review Copilota tylko wtedy, gdy nie przekracza to ustalonego limitu rund.
   e) Domyslny limit to 3 rundy CR - poprawki - CR.
   f) Po trzeciej rundzie poprawek wyslanych do PR nie pros Copilota o kolejne review automatycznie; uznaj proces Copilot CR za zakonczony.

5. Wazne zasady
   a) Nigdy nie wdrazaj sugestii Copilota w ciemno.
   b) Copilot jest reviewerem pomocniczym, nie decydentem.
   c) Decyzje o zastosowaniu kazdej sugestii podejmuje czlowiek.
   d) Jesli czlowiek prosi o szybkie poprawki, nadal pokaz uwagi Copilota przed ich wdrozeniem.

## Chrome Extension

- Po `make build` testuj przez zaladowanie katalogu `dist/` w `chrome://extensions`.
- Po zmianach w `manifest.json`, `background.ts`, `offscreen.ts` albo plikach HTML przeladuj rozszerzenie w `chrome://extensions`.
- Nie dodawaj zewnetrznych uslug ani przesylania nagran poza przegladarke bez jednoznacznej decyzji czlowieka.
