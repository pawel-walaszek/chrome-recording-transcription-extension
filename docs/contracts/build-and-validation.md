# Kontrakt builda i walidacji

Ten dokument opisuje wspierany lokalny przepływ budowania, walidacji i pakietowania rozszerzenia.

Indeks i zasady katalogu kontraktów: [README.md](README.md), [AGENTS.md](AGENTS.md).

## Zasady

1. Domyślny lokalny build i walidacja działają przez `make`, Docker Compose v2 i usługę `builder` z `compose.yml`.
2. Lokalny przepływ pracy nie wymaga instalowania Node.js ani npm na hoście.
3. Runtime buildowy w kontenerze używa obrazu `node:20-bookworm-slim`, zgodnego z główną wersją Node.js używaną przez CI.
4. `node_modules` i cache npm są trzymane w nazwanych wolumenach Dockera, nie w lokalnym katalogu repozytorium.
5. `dist/` jest jedynym podstawowym artefaktem builda zapisywanym na hoście, bo Chrome ładuje rozszerzenie przez `Load unpacked`.
6. `npm ci` jest jedynym wspieranym sposobem instalacji zależności w buildzie; zależności muszą wynikać z `package-lock.json`.
7. Pliki w `dist/` mają być tworzone z UID/GID użytkownika hosta, żeby można je było usuwać i przebudowywać bez naprawiania uprawnień.
8. `dist/` jest wygenerowanym wynikiem builda i nie powinien być edytowany ręcznie.

## Komendy

1. `make build` buduje produkcyjne pliki rozszerzenia do `dist/`.
2. `make check` uruchamia `tsc --noEmit` i produkcyjny build webpacka; to podstawowa walidacja po zmianach w kodzie albo konfiguracji.
3. `make package` buduje `dist/` i tworzy paczkę ZIP w `release/`.
4. `make zip` jest aliasem do `make package`.
5. `make shell` otwiera powłokę w kontenerze buildowym.
6. `make clean` usuwa tylko wygenerowany katalog `dist/`.
7. `make deps-clean` usuwa wolumeny zależności/cache i jest operacją diagnostyczną przy problemach z zależnościami.

## Konfiguracja builda

1. `UPLOAD_API_BASE_URL` domyślnie wskazuje `https://meet2note.com` i może zostać nadpisany przy buildzie, np. `UPLOAD_API_BASE_URL=http://localhost:3000 make build`.
2. `SENTRY_DSN` jest opcjonalny; jeśli nie jest ustawiony, diagnostyka Sentry nie powinna blokować builda.
3. `SENTRY_ENVIRONMENT` domyślnie opisuje build deweloperski rozszerzenia.
4. `HOST_UID` i `HOST_GID` są wyliczane z hosta, ale mogą zostać nadpisane z zewnątrz.

## Walidacja przeglądarkowa

1. Po `make build` albo `make check` należy ładować katalog `dist/` w `chrome://extensions`.
2. Po zmianach w `manifest.json`, service workerze, offscreen albo plikach HTML rozszerzenie trzeba przeładować w `chrome://extensions`.
3. Przy zmianach dotykających przepływów przeglądarkowych wykonaj smoke test z `docs/runbooks/002-smoke-test-po-zmianach.md`.
