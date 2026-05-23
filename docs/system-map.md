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
| Popup | `popup.html`, `src/popup.tsx` | Interfejs React + Ant Design do otwierania ustawień mikrofonu, startu/stopu nagrywania oraz podglądu historii uploadów i nagrań z Meet2Note. |
| Callback Meet2Note | `connect-callback.html`, `src/connectCallback.ts` | Kończy flow połączenia z backendu, waliduje `state`, wymienia jednorazowy `code` na token i zapisuje go lokalnie. |
| Watcher Google Meet | `src/meetWatcher.ts`, `manifest.json` | Content script na `meet.google.com`, który wykrywa aktywne spotkanie i opuszczenie spotkania. |
| Service worker tła | `src/background.ts` | Koordynuje przechwytywanie karty, cykl życia dokumentu offscreen, stan nagrywania/uploadu i znaczniki. |
| Nagrywarka offscreen | `offscreen.html`, `src/offscreen.ts` | Przechwytuje media z karty, nagrywa osobny asset mikrofonu, zapisuje chunki do spoolu i wysyła je do backendu. |
| Lokalny spool nagrań | `src/recordingSpool.ts` | Trwały IndexedDB dla manifestów i chunków nagrań do czasu potwierdzonego uploadu. |
| Klient uploadu | `src/uploadClient.ts` | Wykonuje kontrakt uploadu backendu: `/init`, upload assetów, `/complete`. |
| Klient nagrań | `src/recordingsClient.ts` | Pobiera listę nagrań z backendu przez `GET /api/recordings` z `extensionToken`. |
| Historia nagrań | `src/recordingHistory.ts` | Definiuje model lokalnej historii uploadów i helpery `chrome.storage.local`. |
| Strona konfiguracji mikrofonu | `micsetup.html`, `src/micsetup.tsx` | Widoczna strona React + Ant Design używana do nadania uprawnienia mikrofonu, wyboru urządzenia i zapisu konfiguracji w `chrome.storage.local`. |
| Preferencje mikrofonu | `src/micPreferences.ts` | Wspólne klucze i helpery `chrome.storage.local` dla zapisanego wyboru mikrofonu. |
| Autoryzacja Meet2Note | `src/extensionAuth.ts` | Wspólne helpery `chrome.storage.local` dla długotrwałego `extensionToken`, danych użytkownika i `state` flow połączenia. |
| Diagnostyka Sentry | `src/diagnostics.ts`, `scripts/sentry-public-dsn.sh`, `Makefile` | Opcjonalnie inicjalizuje Sentry, jeśli build ma dostęp do publicznego DSN albo sekretów pozwalających pobrać DSN przez API. |
| Build kontenerowy | `compose.yml`, `Makefile` | Domyślny lokalny punkt wejścia do builda i walidacji. Uruchamia npm w Docker Compose bez lokalnego Node.js. |
| Build webpacka | `webpack.config.js`, `tsconfig.json` | Kompiluje entrypointy TypeScript i kopiuje statyczne pliki rozszerzenia do `dist/`. |
| Backend uploadu | `$HOME/playground/recording-backend` | NestJS + Fastify API oraz React + Vite + Ant Design GUI dla uploadu, przetwarzania i udostępniania nagrań. |

## API Uploadu

Ten opis dokumentuje aktualne ustalenia integracyjne między wtyczką i backendem.

1. Rozszerzenie przechodzi flow `GET /extension/connect`, a callback wymienia jednorazowy `code` przez `POST /api/extension/token`.
2. Długotrwały `extensionToken` jest zapisywany w `chrome.storage.local` i wysyłany jako `Authorization: Bearer <extensionToken>`.
3. Rozszerzenie inicjuje upload przez `POST /api/upload/init`.
4. Backend zwraca `recordingId`, `uploadToken`, opcjonalne `expiresAt`, `recommendedChunkSizeBytes` oraz `maxAssetSizeBytes`.
5. Rozszerzenie inicjalizuje każdy asset przez `PUT /api/upload/{recordingId}/assets/{asset}`.
6. Rozszerzenie wysyła brakujące chunki przez `PUT /api/upload/{recordingId}/assets/{asset}/chunks/{chunkIndex}`.
7. Po chunkach rozszerzenie kończy asset przez `POST /api/upload/{recordingId}/assets/{asset}/complete`.
8. Każdy request uploadu używa nagłówków `Authorization` oraz `X-Upload-Token`.
9. Rozszerzenie kończy upload przez `POST /api/upload/{recordingId}/complete`.
10. Chunks nagrania trafiają do trwałego spoolu IndexedDB już podczas nagrywania, a zakończone nagrania są uploadowane sekwencyjnie.
11. Jeśli upload się nie powiedzie, offscreen ponawia upload konkretnej pozycji co 15 sekund i wznawia sesję backendową, jeśli nadal jest używalna.
12. Jeśli backend zwróci `401` albo `403`, zwykły retry tej pozycji jest przerywany, token jest czyszczony i popup wymaga ponownego połączenia z Meet2Note.
13. Popup scala lokalną historię kolejki z listą nagrań z backendu, jeśli konto jest połączone z Meet2Note.

## Granice uruchomieniowe

1. Pliki wynikowe trafiają bezpośrednio do `https://meet2note.com`, bez automatycznego pobierania lokalnego `.webm`.
2. Chunks nagrań są trzymane w IndexedDB do czasu potwierdzonego uploadu; trwała historia w `chrome.storage.local` zawiera tylko metadane.
3. Wybór mikrofonu i token Meet2Note są zapisywane lokalnie w `chrome.storage.local`.
4. Tokenów, kodów wymiany, nagłówka `Authorization`, `X-Upload-Token` ani blobów nagrań nie wolno logować do konsoli ani Sentry.
5. Content script na Google Meet nie czyta ani nie wysyła treści spotkania; wykrywa tylko stan obecności w spotkaniu.
6. `dist/` jest wygenerowanym wynikiem builda i nie powinien być edytowany ręcznie.

## Lokalna walidacja

1. Uruchom `make check`.
2. Załaduj `dist/` w `chrome://extensions`.
3. Sprawdź flow `Connect to Meet2Note`, start/stop nagrywania, upload do backendu i retry, jeśli zmieniasz kod przechwytywania, offscreen, uploadu albo uprawnień.

GitHub Actions może nadal wywoływać skrypty npm bezpośrednio, ale wspierany lokalny przepływ pracy to `make`.
