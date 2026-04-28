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
- Przed zmianami w `manifest.json`, `src/background.ts`, `src/offscreen.ts`, `src/popup.tsx`, `src/micsetup.tsx`, `webpack.config.js` albo HTML rozszerzenia stosuj przewodnik `docs/agent-guides/chrome-extension-ts.md`.
- Uprawnienia Chrome i `host_permissions` zmieniaj tylko wtedy, gdy wymaga tego funkcjonalnosc, i opisz powod w podsumowaniu.
- Przy kazdym generowaniu nowej wtyczki podbijaj `version` w `manifest.json`.
- Przy poprawkach bugow podbijaj ostatnia liczbe wersji, np. `1.1.0` -> `1.1.1`.
- Zmiany UX, drobne funkcje pomocnicze i male usprawnienia podbijaja patch, nie minor. Minor podbijaj tylko dla znaczacych funkcji albo zmian zachowania o wiekszym zakresie.
- Zmiana `version` w `manifest.json` jest sygnalem release paczki ZIP; po pushu do `main` workflow `Publish Extension Package` powinien zbudowac i opublikowac paczke.

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

## Doprecyzowywanie specyfikacji

1. Przy pracy nad specyfikacja end-to-end najpierw samodzielnie rozstrzygaj niejednoznacznosci, ktore wynikaja z architektury, historii ustalen albo istniejacego kodu.
2. Pytaj czlowieka tylko o decyzje, ktorych nie da sie bezpiecznie wywnioskowac z kontekstu.
3. Pytania zadawaj pojedynczo, nigdy seria.
4. Przy kazdym pytaniu podawaj licznik w formacie `Pytanie X z Y`, zeby bylo jasne, ile decyzji zostalo.
5. Po odpowiedzi czlowieka zapisz decyzje w specyfikacji i powiazanych issue, jesli istnieja.

## GitHub i proces pracy

- Glowne repozytorium ustalaj z `git remote -v`.
- Domyslny hosting to GitHub.
- Jesli dla operacji istnieje odpowiedni serwer MCP, uzyj go jako pierwszej sciezki pozyskania danych lub wykonania operacji.
- Commit, push i tworzenie Pull Request wykonuj tylko po wyraznej zgodzie czlowieka.
- PR powinien zawierac zakres, sposob weryfikacji, ryzyka oraz informacje o zmianach w uprawnieniach Chrome, jesli takie wystapily.

## Powiazane repozytorium backendu

1. Backend dla tej wtyczki znajduje sie w repozytorium `recording-backend`.
   a) Lokalna sciezka: `/Users/pawel.walaszek/playground/recording-backend`.
   b) GitHub: `pawel-walaszek/recording-backend`.

2. Backend jest docelowym server-side dla uploadu, przetwarzania, transkrypcji i udostepniania nagran z tej wtyczki.
   a) Aktualny backend jest aplikacja Node.js/TypeScript oparta o NestJS + Fastify.
   b) Webowe GUI backendu jest aplikacja React + Vite + Ant Design.
   c) Repo backendu uzywa pnpm workspaces oraz `docker compose up -d` jako podstawowego sposobu uruchamiania.

3. Przy zmianach dotyczacych uploadu, formatu plikow, metadanych nagrania, autoryzacji, API albo przyszlego MCP:
   a) sprawdz repo backendu,
   b) sprawdz kontrakt API backend-wtyczka,
   c) zaktualizuj dokumentacje po obu stronach,
   d) uruchom dostepne walidacje albo opisz, czego nie dalo sie sprawdzic.

4. Zrodlem ustalen integracyjnych sa specyfikacje i issue cross-repo oraz realne zachowanie API backendu.
   a) Jesli backend wybierze konkretna forme dokumentowania API, dopiero wtedy linkuj ja jako referencje.

5. Docelowy endpoint dla uploadu z rozszerzenia to `https://meet2note.com`.
   a) Na obecnym etapie traktuj `https://meet2note.com` jako srodowisko deweloperskie/prod-like, mimo ze domena wyglada produkcyjnie.
   b) Lokalny backend nadal moze dzialac pod `http://localhost:3000`.
   c) Nie hardcoduj sekretow ani tokenow; dlugotrwaly `extensionToken` jest zapisywany lokalnie po flow `Connect to Meet2Note`.
   d) Po wdrozeniu uploadu nie pobieraj automatycznie lokalnego pliku `.webm`; upload ma zastapic lokalny zapis.

6. Obecny kontrakt polaczenia i uploadu:
   a) `GET /extension/connect` uruchamia backendowy flow polaczenia wtyczki z kontem Meet2Note.
   b) `POST /api/extension/token` wymienia jednorazowy `code` na dlugotrwaly `extensionToken`.
   c) `POST /api/upload/init` wymaga `Authorization: Bearer <extensionToken>`, tworzy sesje uploadu i zwraca `recordingId`, `uploadToken` oraz `expiresAt`.
   d) `PUT /api/upload/{recordingId}/video` wysyla asset `video_audio` jako `application/octet-stream` z naglowkami `Authorization` i `X-Upload-Token`.
   e) `PUT /api/upload/{recordingId}/microphone` wysyla opcjonalny asset mikrofonu jako `application/octet-stream` z naglowkami `Authorization` i `X-Upload-Token`.
   f) `POST /api/upload/{recordingId}/complete` konczy upload z naglowkami `Authorization` i `X-Upload-Token`.
   g) Przy `401` albo `403` nie ponawiaj zwyklego uploadu bez konca; wyczysc token i pokaz koniecznosc ponownego polaczenia z Meet2Note.

## Komunikacja cross-repo

1. Jesli zmiana w tym repozytorium wymaga pracy po stronie `recording-backend`, utworz issue w repozytorium backendu z konkretnym zakresem, kontekstem i kryteriami akceptacji.
2. Jesli zmiana w `recording-backend` wymaga pracy po stronie tej wtyczki, oczekiwanym miejscem przekazania pracy jest issue w tym repozytorium.
3. W issue linkuj odpowiednia specyfikacje, kontrakt albo PR, jesli istnieje.
4. Nie zakladaj, ze ustalenia z rozmowy sa wystarczajaca dokumentacja zaleznosci miedzy projektami.

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
   c) Do odwolania wykonuj tylko jedna runde PR/CR z Copilotem.
   d) Jesli Copilot zglosi techniczne uwagi, wdrazaj je wedlug wlasnej rekomendacji bez pytania czlowieka o kazda z nich.
   e) Pytaj czlowieka tylko wtedy, gdy uwaga jest trade-offem, moze zmienic zalozenia funkcjonalne albo wymaga decyzji produktowej.
   f) Jesli pytasz o uwage CR, podaj licznik w formacie `Pytanie X z Y` i wyjasnij kontekst szerzej niz jednym zdaniem.

3. Odpowiedzi do review
   a) Na kazda uwage Copilota odpowiedz w watku:
      - `fixed` + krotko co zostalo zmienione
      - `not applying` + krotko dlaczego nie wdrazamy
      - `unclear` + pytanie doprecyzowujace
   b) Nie zostawiaj komentarzy Copilota bez odpowiedzi.
   c) Jesli uwaga jest trade-offem albo moze zmienic zalozenia funkcjonalne, zawsze pytaj czlowieka przed wdrozeniem.
   d) Przed zakonczeniem pracy z CR sprawdz thread-aware stan review i upewnij sie, ze kazda uwaga Copilota ma odpowiedz w watku oraz jest resolved albo ma jawne wyjasnienie `not applying`/`unclear`.
   e) Brak odpowiedzi przy uwadze Copilota jest traktowany jako blad procesu, bo czlowiek uzywa odpowiedzi jako sygnalu, czy i jak uwaga zostala uwzgledniona.

4. Kolejne rundy
   a) Po wdrozeniu zatwierdzonych przez czlowieka poprawek zrob commit i push.
   b) Nie pros Copilota o ponowne review po wdrozeniu poprawek z jego rundy, chyba ze czlowiek wyraznie o to poprosi.
   c) Po jednej rundzie CR i odpowiedzeniu na jej watki uznaj proces Copilot CR za zakonczony.

5. Wazne zasady
   a) Copilot jest reviewerem pomocniczym, nie decydentem.
   b) Decyzje techniczne podejmuj samodzielnie wedlug najlepszej rekomendacji, respektujac architekture projektu.
   c) Decyzje produktowe, trade-offy i zmiany zalozen funkcjonalnych nadal eskaluj do czlowieka.

## Chrome Extension

- Po `make build` testuj przez zaladowanie katalogu `dist/` w `chrome://extensions`.
- Po zmianach w `manifest.json`, `background.ts`, `offscreen.ts` albo plikach HTML przeladuj rozszerzenie w `chrome://extensions`.
- Nie dodawaj zewnetrznych uslug ani przesylania nagran poza przegladarke bez jednoznacznej decyzji czlowieka.
