# Mapa systemu

## Cel

To repozytorium buduje rozszerzenie Chrome Manifest V3 do nagrywania spotkań w przeglądarce.

Rozszerzenie nagrywa bieżącą kartę i wysyła assety bezpośrednio do backendu działającego pod `https://meet2note.com`. Na obecnym etapie ta domena jest traktowana jako środowisko deweloperskie/prod-like, bo aplikacja nie jest jeszcze faktycznie uruchomiona produkcyjnie.

Docelowy backend dla uploadu i przetwarzania nagrań będzie rozwijany w powiązanym repozytorium `recording-backend`:

1. Lokalnie: `$HOME/playground/recording-backend`.
2. GitHub: `pawel-walaszek/recording-backend`.
3. Lokalny API base URL: `http://localhost:3000`.
4. Dev/prod-like API base URL dla wtyczki: `https://meet2note.com`.
5. Ustalenia integracyjne są utrzymywane w issue cross-repo, specyfikacjach i dokumentacji projektu.

## Komponenty

| Komponent | Ścieżka | Rola |
| --- | --- | --- |
| Manifest | `manifest.json` | Deklaruje metadane MV3, uprawnienia, worker tła i dostępne zasoby. |
| Popup | `popup.html`, `src/popup.tsx` | Interfejs React + Ant Design do otwierania ustawień mikrofonu oraz startu/stopu nagrywania. |
| Watcher Google Meet | `src/meetWatcher.ts`, `manifest.json` | Content script na `meet.google.com`, który wykrywa aktywne spotkanie i opuszczenie spotkania. |
| Service worker tła | `src/background.ts` | Koordynuje przechwytywanie karty, cykl życia dokumentu offscreen, stan nagrywania/uploadu i znaczniki. |
| Nagrywarka offscreen | `offscreen.html`, `src/offscreen.ts` | Przechwytuje media z karty, nagrywa osobny asset mikrofonu, finalizuje bloby i wysyła je do backendu. |
| Klient uploadu | `src/uploadClient.ts` | Wykonuje kontrakt uploadu backendu: `/init`, upload assetów, `/complete`. |
| Strona konfiguracji mikrofonu | `micsetup.html`, `src/micsetup.tsx` | Widoczna strona React + Ant Design używana do nadania uprawnienia mikrofonu, wyboru urządzenia i zapisu konfiguracji w `chrome.storage.local`. |
| Preferencje mikrofonu | `src/micPreferences.ts` | Wspólne klucze i helpery `chrome.storage.local` dla zapisanego wyboru mikrofonu. |
| Diagnostyka Sentry | `src/diagnostics.ts`, `scripts/sentry-public-dsn.sh`, `Makefile` | Opcjonalnie inicjalizuje Sentry, jeśli build ma dostęp do publicznego DSN albo sekretów pozwalających pobrać DSN przez API. |
| Build kontenerowy | `compose.yml`, `Makefile` | Domyślny lokalny punkt wejścia do builda i walidacji. Uruchamia npm w Docker Compose bez lokalnego Node.js. |
| Build webpacka | `webpack.config.js`, `tsconfig.json` | Kompiluje entrypointy TypeScript i kopiuje statyczne pliki rozszerzenia do `dist/`. |
| Backend uploadu | `$HOME/playground/recording-backend` | NestJS + Fastify API oraz React + Vite + Ant Design GUI dla uploadu, przetwarzania i udostępniania nagrań. |

## API Uploadu

Ten opis dokumentuje aktualne ustalenia integracyjne między wtyczką i backendem.

1. Rozszerzenie inicjuje upload przez `POST /api/upload/init`.
2. Backend zwraca `recordingId`, `uploadToken` oraz `expiresAt`.
3. Rozszerzenie wysyła główny asset `video_audio` przez `PUT /api/upload/{recordingId}/video`.
4. Jeśli mikrofon jest dostępny, rozszerzenie wysyła osobny asset `microphone` przez `PUT /api/upload/{recordingId}/microphone`.
5. Każdy upload assetu używa nagłówka `X-Upload-Token`.
6. Rozszerzenie kończy upload przez `POST /api/upload/{recordingId}/complete`.
7. Jeśli upload się nie powiedzie, offscreen ponawia pełny upload co 15 sekund aż do sukcesu, bez lokalnego zapisu pliku.

## Granice uruchomieniowe

1. Pliki wynikowe trafiają bezpośrednio do `https://meet2note.com`, bez automatycznego pobierania lokalnego `.webm`.
2. Gotowe bloby są trzymane tylko w pamięci na czas uploadu i retry.
3. Wybór mikrofonu jest zapisywany lokalnie w `chrome.storage.local`.
4. Content script na Google Meet nie czyta ani nie wysyła treści spotkania; wykrywa tylko stan obecności w spotkaniu.
5. `dist/` jest wygenerowanym wynikiem builda i nie powinien być edytowany ręcznie.

## Lokalna walidacja

1. Uruchom `make check`.
2. Załaduj `dist/` w `chrome://extensions`.
3. Sprawdź start/stop nagrywania, upload do backendu i retry, jeśli zmieniasz kod przechwytywania, offscreen, uploadu albo uprawnień.

GitHub Actions może nadal wywoływać skrypty npm bezpośrednio, ale wspierany lokalny przepływ pracy to `make`.
