# Runbook: publikacja paczki ZIP wtyczki

## Cel

Powtarzalnie zbudowac, spakowac i opublikowac paczke ZIP rozszerzenia Chrome tak, aby backend Meet2Note mogl ja pokazac jako przycisk `Chrome extension` w prawym gornym rogu headera web UI.

## Wymagania

- Docker z obsluga `docker compose` v2.
- `make`.
- Lokalnie dostepne polecenie `zip`.
- Uprawnienia do pushu na `main` w repo wtyczki, jesli publikacja ma pojsc automatycznie przez GitHub Actions.
- Po stronie backendu naprawiony i stabilny katalog publikacji ZIP-ow, domyslnie `/home/docker/recording-backend/shared/downloads`.

## Domyslna sciezka

1. Domyslna sciezka publikacji jest automatyczna.
2. Gdy zmieniasz `version` w `manifest.json` i wypychasz commit na `main`, workflow `Publish Extension Package`:
   a) wykrywa bump wersji,
   b) buduje rozszerzenie,
   c) tworzy ZIP `meet2note-chrome-extension-vX.Y.Z.zip`,
   d) zapisuje artefakt workflow,
   e) publikuje ZIP do katalogu downloadow Meet2Note,
   f) waliduje `GET /api/extension/download/latest` oraz `GET /api/extension/download/latest/file`.
3. Jesli `version` sie nie zmienila, workflow nie publikuje ZIP-a.

## Kroki lokalne przed pushem

1. Podbij `version` w `manifest.json`.
2. Uruchom `make check`.
3. Jesli zmiana dotyka przeplywow przegladarkowych, wykonaj runbook [`002-smoke-test-po-zmianach.md`](002-smoke-test-po-zmianach.md).
4. Uruchom `make package`.
5. Potwierdz, ze powstal plik:
   - `release/meet2note-chrome-extension-vX.Y.Z.zip`
6. Jesli chcesz sprawdzic zawartosc ZIP lokalnie, uruchom:

```bash
unzip -l release/meet2note-chrome-extension-vX.Y.Z.zip
```

## Kryteria poprawnej paczki

- Nazwa pliku ma format `meet2note-chrome-extension-vX.Y.Z.zip`.
- `X.Y.Z` pochodzi z `manifest.json`.
- ZIP zawiera pliki rozszerzenia bez dodatkowego katalogu nadrzednego.
- `dist/manifest.json` ma te sama wersje co glowny `manifest.json`.

## Automatyczna publikacja po pushu do `main`

1. Wypchnij commit z podbita wersja na `main`.
2. Poczekaj na workflow `Publish Extension Package`.
3. Sprawdz w GitHub Actions:
   a) job `detect-version-bump`,
   b) job `build-package`,
   c) job `publish-to-meet2note`.
4. Potwierdz, ze workflow przeszedl na zielono.

## Walidacja po publikacji

1. Sprawdz metadane:

```bash
curl https://meet2note.com/api/extension/download/latest
```

2. Oczekiwany wynik:
   a) `available: true`,
   b) `version` zgodne z nowa wersja,
   c) `fileName` zgodny z nazwa ZIP-a,
   d) `downloadUrl: /api/extension/download/latest/file`.

3. Sprawdz sam plik:

```bash
curl -I https://meet2note.com/api/extension/download/latest/file
```

4. Oczekiwany wynik:
   a) `200`,
   b) `Content-Type: application/zip`,
   c) `Content-Disposition` z aktualna nazwa ZIP-a.

5. Otworz web UI Meet2Note i potwierdz, ze w prawym gornym rogu headera renderuje sie przycisk `Chrome extension`.

## Fallback reczny

1. Uzyj tylko wtedy, gdy automatyczny workflow jest niedostepny albo debugujesz publikacje.
2. Zbuduj paczke:

```bash
make package
```

3. Wrzuc plik do katalogu downloadow backendu:
   - domyslnie `/home/docker/recording-backend/shared/downloads`
4. Powtorz kroki walidacyjne z sekcji wyzej.

## Kryteria zaliczenia

- `make check` konczy sie sukcesem.
- `make package` tworzy ZIP z prawidlowa nazwa.
- Push na `main` z nowa wersja uruchamia workflow publikacji.
- Backend zwraca aktualna wersje przez `/api/extension/download/latest`.
- Web UI Meet2Note pokazuje przycisk `Chrome extension`.
