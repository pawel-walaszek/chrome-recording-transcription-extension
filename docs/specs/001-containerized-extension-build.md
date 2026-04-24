# Spec: containerized extension build

## Podsumowanie

Celem jest dodanie kontenerowego sposobu budowania rozszerzenia, tak aby lokalnie nie trzeba bylo instalowac Node.js ani uruchamiac `npm` na hoscie. Repo dostanie `compose.yml` z usluga buildowa oraz `Makefile`, ktory jednym poleceniem uruchomi build w kontenerze i zapisze wynik w lokalnym `dist/`.

Realizacja specyfikacji ma tez przestawic instrukcje projektu tak, aby domyslnym sposobem lokalnego budowania i walidacji byl `make` uruchamiajacy kontener. Lokalny `npm` ma zostac opisany jako wariant alternatywny dla osob, ktore swiadomie chca uzywac lokalnego Node.js.

Zakres jest narzedziowy: bez zmian w logice rozszerzenia, manifestu i uprawnien Chrome.

## Cel

Umozliwic zbudowanie rozszerzenia komenda typu:

```bash
make build
```

bez lokalnego `npm install`, lokalnego `node_modules/` i lokalnej instalacji Node.js.

## Proponowany zakres zmian

1. `compose.yml`
   a) Dodac usluge `builder` oparta o oficjalny obraz `node:20-bookworm-slim`.
   b) Zamontowac pliki i katalogi zrodlowe do `/workspace` jako precyzyjne mounty read-only.
   c) Uzyc wolumenu Docker dla `/workspace/node_modules`, aby zaleznosci nie byly zapisywane na hoscie.
   d) Uzyc wolumenu Docker dla cache npm, aby kolejne buildy byly szybsze.
   e) Ustawic `working_dir` na `/workspace`.
   f) Przekazac UID/GID z hosta przez zmienne `HOST_UID` i `HOST_GID`, zeby pliki wygenerowane w `dist/` nie byly tworzone jako `root`.
   g) Zamontowac lokalny `./dist` do `/workspace/dist`, bo tylko artefakt builda ma trafic na hosta.

2. `Makefile`
   a) Dodac `make build`, ktore uruchamia w kontenerze `npm ci` i produkcyjny build webpacka.
   b) Dodac `make check`, ktore uruchamia w kontenerze `npm ci`, `tsc --noEmit` i produkcyjny build webpacka.
   c) Dodac `make shell` dla wejscia do srodowiska buildowego.
   d) Dodac `make clean` do usuniecia wygenerowanego `dist/`.
   e) Dodac `make deps-clean` do usuniecia wolumenow zaleznosci/cache.
   f) Uzywac `docker compose`, nie starszego polecenia `docker-compose`.
   g) Wyliczac `HOST_UID` i `HOST_GID` w Makefile przez `id -u` i `id -g`, z mozliwoscia nadpisania z zewnatrz.

3. Dokumentacja i instrukcje projektowe
   a) Zaktualizowac `README.md` tak, aby domyslny workflow lokalny byl oparty o kontener:
      - `make build`
      - zaladowanie `dist/` w `chrome://extensions`
   b) Opisac lokalny `npm install` / `npm run build` jako wariant alternatywny, nie glowny.
   c) Zaktualizowac `AGENTS.md`, aby dla agentow domyslna walidacja po zmianach byla `make check`, a nie `npm run check`.
   d) Zaktualizowac `docs/system-map.md`, aby uwzglednic Docker Compose jako domyslne lokalne narzedzie buildowe.
   e) Zaktualizowac `docs/runbooks/002-smoke-test-po-zmianach.md`, aby podstawowa sciezka smoke testu uzywala `make check`.
   f) Zaktualizowac `scripts/README.md`, jesli dodany workflow zmieni opis helperow.
   g) Zaktualizowac `.github/PULL_REQUEST_TEMPLATE.md`, jesli checklisty lub weryfikacja wskazuja obecnie lokalny `npm run check` jako glowna komende.

## Zasady realizacji

1. W trakcie implementacji rozstrzygaj niejednoznacznosci samodzielnie, jesli odpowiedz wynika z tej specyfikacji, architektury projektu albo oczywistych ograniczen technicznych.
2. Nie zatrzymuj realizacji na decyzjach opisanych juz w sekcji `Decyzje projektowe`.
3. Jesli pojawi sie niejednoznacznosc, ktorej nie da sie uczciwie rozstrzygnac z kontekstu, zadaj czlowiekowi jedno konkretne pytanie i czekaj na odpowiedz.
4. Nie zadawaj serii pytan naraz.

## Poza zakresem

1. Zmiany w kodzie TypeScript rozszerzenia.
2. Zmiany w `manifest.json` i uprawnieniach Chrome.
3. Publikowanie rozszerzenia do Chrome Web Store.
4. Zmiana GitHub Actions CI z `npm ci` na Docker Compose.
5. Dodawanie wlasnego `Dockerfile`, jesli oficjalny obraz Node.js wystarczy.

## Decyzje projektowe

1. `node_modules` nie powinno trafic na hosta.
   a) Implementacja ma uzyc nazwanego wolumenu Docker dla `/workspace/node_modules`.
   b) Nie montuj calego repozytorium jako `/workspace`, bo Docker utworzy lokalny katalog `node_modules/` jako punkt montowania zagniezdzonego wolumenu.
   c) Uzasadnienie: glowny cel to build bez lokalnego npm i bez lokalnego drzewa zaleznosci.

2. `dist/` powinien zostac zapisany na hoscie.
   a) Uzasadnienie: Chrome ma ladowac lokalny katalog `dist/` przez `Load unpacked`.

3. Kontener powinien uruchamiac `npm ci`, nie `npm install`.
   a) `make build` i `make check` maja uruchamiac `npm ci` przy kazdym wykonaniu jako krok przygotowania zaleznosci.
   b) Krok `npm ci` ma dzialac jako `root`, bo npm usuwa i odtwarza `node_modules`, a katalog ten jest bezposrednim mountem nazwanego wolumenu.
   c) Po `npm ci` Makefile ma przywrocic wlasciciela `/workspace`, `/workspace/dist`, `/workspace/node_modules` i cache npm na `HOST_UID:HOST_GID`.
   d) Wlasciwy typecheck i build maja dzialac jako `HOST_UID:HOST_GID`, najlepiej przez bezposrednie binarki z `node_modules/.bin`, zeby nie pisac dodatkowych logow npm.
   e) Uzasadnienie: build ma byc powtarzalny i zgodny z `package-lock.json`, a artefakty w `dist/` nie powinny byc tworzone jako `root`.

4. `Makefile` powinien byc cienka nakladka na Docker Compose.
   a) Uzasadnienie: uzytkownik ma pamietac `make build`, a szczegoly Compose zostaja w repo.

5. Dokumentacja powinna promowac `make` jako sciezke domyslna.
   a) Uzasadnienie: glowny cel zmiany to usuniecie wymogu lokalnego npm z typowego workflow.

6. Cache npm powinien byc trwaly miedzy buildami.
   a) Implementacja ma uzyc nazwanego wolumenu Docker dla cache npm.
   b) Uzasadnienie: `npm ci` pozostaje deterministyczne, a cache zmniejsza koszt kolejnych instalacji.

7. `make clean` powinien usuwac tylko wygenerowany katalog `dist/`.
   a) Uzasadnienie: czyszczenie artefaktow builda nie powinno kasowac cache zaleznosci.

8. `make deps-clean` powinien usuwac wolumeny zaleznosci i cache npm.
   a) Uzasadnienie: reset zaleznosci ma byc jawna operacja diagnostyczna, uzywana przy problemach z wolumenami albo lockfile.

9. Compose ma byc uruchamiany przez `docker compose` v2.
   a) Uzasadnienie: to aktualny interfejs Docker Compose i taki wymog ma trafic do README.

10. Obraz buildowy to `node:20-bookworm-slim`.
   a) Uzasadnienie: CI uzywa Node.js 20, wiec lokalny kontener powinien trzymac te sama glowna wersje runtime'u.

## Proponowany interfejs

```bash
make build
make check
make shell
make clean
make deps-clean
```

## Kryteria akceptacji

1. `make build` dziala na maszynie z Dockerem i Docker Compose v2, bez lokalnego Node.js/npm.
2. Po `make build` istnieje lokalny katalog `dist/` z plikami rozszerzenia.
3. `make check` uruchamia typecheck i production build w kontenerze.
4. Na hoscie nie powstaje lokalny `node_modules/`.
5. Wygenerowane pliki w `dist/` sa zapisywalne/usuwalne przez uzytkownika hosta.
6. README wskazuje `make build` jako domyslny sposob budowania rozszerzenia.
7. README opisuje lokalny `npm` jako wariant alternatywny.
8. AGENTS i runbook smoke testu wskazuja `make check` jako domyslna walidacje lokalna.

## Plan weryfikacji

1. Uruchomic:

```bash
make check
```

2. Potwierdzic, ze nie powstal lokalny katalog `node_modules/`.
3. Potwierdzic, ze `dist/manifest.json`, `dist/background.js`, `dist/popup.js`, `dist/offscreen.js`, `dist/scrapingScript.js` i `dist/micsetup.js` istnieja.
4. Uruchomic:

```bash
make clean
make build
```

5. Zaladowac `dist/` w `chrome://extensions` jako `Load unpacked`.

## Ryzyka

1. Uprawnienia plikow w `dist/`
   a) Mitigacja: uruchamiac wlasciwy build/check z UID/GID hosta przez zmienne przekazane z Makefile.

2. Roznice Docker Compose miedzy systemami
   a) Mitigacja: zakladac `docker compose` v2 i opisac to w README.

3. Wolumen `node_modules` moze przechowywac stare zaleznosci
   a) Mitigacja: dodac `make deps-clean` i dokumentowac uzycie przy problemach z zaleznosciami.

## Rozstrzygniete decyzje

1. `make check` ma byc rekomendowana podstawowa walidacja lokalna.
2. `npm run check` pozostaje dostepne jako alternatywa dla osob z lokalnym Node.js.
