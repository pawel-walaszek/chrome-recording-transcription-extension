# Instrukcje GitHub Copilot

Stosuj te zasady przy generowaniu kodu, komentarzy i uwag review w tym repozytorium.

## Kontekst projektu

1. To rozszerzenie Chrome Manifest V3 dla Google Meet.
2. Kod źródłowy to TypeScript w `src/`.
3. webpack buduje entrypointy JavaScript i kopiuje `manifest.json` oraz pliki HTML do `dist/`.
4. Rozszerzenie wysyła nagrania do backendu uploadu i przetwarzania w repozytorium `pawel-walaszek/recording-backend`.
5. Docelowy endpoint uploadu dla etapu dev/prod-like to `https://meet2note.com`.
6. Ustalenia integracyjne z backendem są utrzymywane w specyfikacjach, issue cross-repo i realnym zachowaniu API.
7. Lokalne wzorce MV3, media, messagingu, storage i TypeScript są opisane w `docs/agent-guides/chrome-extension-ts.md`.

## Priorytety review

1. Regresje funkcjonalne w przechwytywaniu karty, nagrywaniu offscreen, uploadzie assetów i przepływie uprawnień mikrofonu.
2. Ryzyka bezpieczeństwa i prywatności, szczególnie niepotrzebne uprawnienia Chrome albo dane opuszczające przeglądarkę.
3. Brak walidacji dla zmienionego zachowania.
4. Niespójność z istniejącą prostą strukturą TypeScript/webpack.
5. Niepotrzebna złożoność albo szerokie refaktory.
6. Niezgodność z `docs/agent-guides/chrome-extension-ts.md`, szczególnie przy zmianach w MV3 lifecycle, offscreen, storage, messagingu i media devices.

## Kompletność review

1. W jednej rundzie review zgłoś wszystkie możliwe do wdrożenia uwagi, które potrafisz zidentyfikować.
2. Nie cedź celowo uwag przez wiele rund review.
3. Kolejne rundy powinny skupiać się na nowo wprowadzonych zmianach, nierozwiązanych uwagach albo problemach, które nie były rozsądnie widoczne w poprzedniej rundzie.
4. Jeśli uwag jest dużo, grupuj powiązane problemy i zaczynaj od tych o najwyższym ryzyku.

## Styl

1. Trzymaj publiczną, agentową i procesową dokumentację po polsku.
2. Teksty widoczne dla użytkownika rozszerzenia zmieniaj tylko wtedy, gdy zadanie wyraźnie tego dotyczy.
3. Unikaj kosmetycznych komentarzy review, chyba że wpływają na zachowanie, utrzymywalność albo czytelność.
4. Preferuj małe, konkretne sugestie powiązane z konkretnym plikiem i scenariuszem.

## Walidacja

1. Używaj `make check` dla zmian w kodzie albo konfiguracji.
2. Poproś o ręczne testy rozszerzenia Chrome albo opisz je, gdy zmienia się zachowanie w przeglądarce.

## Komunikacja cross-repo

1. Jeśli review albo generowana zmiana wymaga pracy po stronie `recording-backend`, zgłoś to jako osobne issue w repozytorium backendu.
2. Jeśli problem po stronie backendu wymaga zmiany wtyczki, oczekiwanym miejscem przekazania pracy jest issue w tym repozytorium.
3. W issue podawaj kontekst, oczekiwany kontrakt, kryteria akceptacji i link do specyfikacji albo PR, jeśli istnieje.
