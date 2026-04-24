# Mapa systemu

## Cel

To repozytorium buduje rozszerzenie Chrome Manifest V3 działające na `https://meet.google.com/*`.

Rozszerzenie zapisuje napisy Google Meet jako lokalną transkrypcję `.txt` i może nagrywać bieżącą kartę Meet do lokalnego pliku `.webm`. Nagrywanie i eksport transkrypcji odbywają się w przeglądarce.

## Komponenty

| Komponent | Ścieżka | Rola |
| --- | --- | --- |
| Manifest | `manifest.json` | Deklaruje metadane MV3, uprawnienia, skrypty treści, worker tła i dostępne zasoby. |
| Popup | `popup.html`, `src/popup.ts` | Kontrolki użytkownika do pobierania transkrypcji, nadawania uprawnień mikrofonu oraz startu/stopu nagrywania. |
| Service worker tła | `src/background.ts` | Koordynuje przechwytywanie karty, cykl życia dokumentu offscreen, stan nagrywania, znacznik i pobieranie plików. |
| Nagrywarka offscreen | `offscreen.html`, `src/offscreen.ts` | Przechwytuje media z karty, opcjonalnie miksuje audio mikrofonu, nagrywa przez `MediaRecorder` i zwraca URL blobu do pobrania. |
| Strona konfiguracji mikrofonu | `micsetup.html`, `src/micsetup.ts` | Widoczna strona rozszerzenia używana do nadania uprawnienia mikrofonu, gdy prośba o dostęp w popupie jest zawodna. |
| Kolektor napisów | `src/scrapingScript.ts` | Skrypt treści obserwujący DOM napisów Google Meet i buforujący linie transkrypcji. |
| Build kontenerowy | `compose.yml`, `Makefile` | Domyślny lokalny punkt wejścia do builda i walidacji. Uruchamia npm w Docker Compose bez lokalnego Node.js. |
| Build webpacka | `webpack.config.js`, `tsconfig.json` | Kompiluje entrypointy TypeScript i kopiuje statyczne pliki rozszerzenia do `dist/`. |

## Granice uruchomieniowe

1. Zakres hosta jest ograniczony do Google Meet przez `host_permissions`.
2. Pliki wynikowe są zapisywane lokalnie przez Chrome Downloads API.
3. Rozszerzenie nie wymaga backendu, bazy danych ani przechowywania w chmurze.
4. `dist/` jest wygenerowanym wynikiem builda i nie powinien być edytowany ręcznie.

## Lokalna walidacja

1. Uruchom `make check`.
2. Załaduj `dist/` w `chrome://extensions`.
3. Sprawdź działanie transkrypcji na stronie Google Meet z włączonymi napisami.
4. Sprawdź start/stop nagrywania i pobieranie pliku, jeśli zmieniasz kod przechwytywania, offscreen albo uprawnień.

GitHub Actions może nadal wywoływać skrypty npm bezpośrednio, ale wspierany lokalny przepływ pracy to `make`.
