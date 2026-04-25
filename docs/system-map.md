# Mapa systemu

## Cel

To repozytorium buduje rozszerzenie Chrome Manifest V3 do nagrywania spotkań w przeglądarce.

Rozszerzenie nagrywa bieżącą kartę do lokalnego pliku `.webm`. Nagrywanie odbywa się w przeglądarce, bez backendu.

## Komponenty

| Komponent | Ścieżka | Rola |
| --- | --- | --- |
| Manifest | `manifest.json` | Deklaruje metadane MV3, uprawnienia, worker tła i dostępne zasoby. |
| Popup | `popup.html`, `src/popup.ts` | Kontrolki użytkownika do otwierania ustawień mikrofonu oraz startu/stopu nagrywania. |
| Watcher Google Meet | `src/meetWatcher.ts`, `manifest.json` | Content script na `meet.google.com`, który wykrywa aktywne spotkanie i opuszczenie spotkania. |
| Service worker tła | `src/background.ts` | Koordynuje przechwytywanie karty, cykl życia dokumentu offscreen, stan nagrywania, znacznik i pobieranie plików. |
| Nagrywarka offscreen | `offscreen.html`, `src/offscreen.ts` | Przechwytuje media z karty, opcjonalnie miksuje audio mikrofonu, nagrywa przez `MediaRecorder` i zwraca URL blobu do pobrania. |
| Strona konfiguracji mikrofonu | `micsetup.html`, `src/micsetup.ts` | Widoczna strona rozszerzenia używana do nadania uprawnienia mikrofonu, wyboru urządzenia i zapisu konfiguracji w `chrome.storage.local`. |
| Preferencje mikrofonu | `src/micPreferences.ts` | Wspólne klucze i helpery `chrome.storage.local` dla zapisanego wyboru mikrofonu. |
| Diagnostyka Sentry | `src/diagnostics.ts`, `scripts/sentry-public-dsn.sh`, `Makefile` | Opcjonalnie inicjalizuje Sentry, jeśli build ma dostęp do publicznego DSN albo sekretów pozwalających pobrać DSN przez API. |
| Build kontenerowy | `compose.yml`, `Makefile` | Domyślny lokalny punkt wejścia do builda i walidacji. Uruchamia npm w Docker Compose bez lokalnego Node.js. |
| Build webpacka | `webpack.config.js`, `tsconfig.json` | Kompiluje entrypointy TypeScript i kopiuje statyczne pliki rozszerzenia do `dist/`. |

## Granice uruchomieniowe

1. Pliki wynikowe są zapisywane lokalnie przez Chrome Downloads API.
2. Rozszerzenie nie wymaga backendu, bazy danych ani przechowywania w chmurze.
3. Wybór mikrofonu jest zapisywany lokalnie w `chrome.storage.local`.
4. Content script na Google Meet nie czyta ani nie wysyła treści spotkania; wykrywa tylko stan obecności w spotkaniu.
5. `dist/` jest wygenerowanym wynikiem builda i nie powinien być edytowany ręcznie.

## Lokalna walidacja

1. Uruchom `make check`.
2. Załaduj `dist/` w `chrome://extensions`.
3. Sprawdź start/stop nagrywania i pobieranie pliku, jeśli zmieniasz kod przechwytywania, offscreen albo uprawnień.

GitHub Actions może nadal wywoływać skrypty npm bezpośrednio, ale wspierany lokalny przepływ pracy to `make`.
