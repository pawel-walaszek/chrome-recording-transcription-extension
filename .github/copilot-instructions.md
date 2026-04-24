# Instrukcje GitHub Copilot

Stosuj te zasady przy generowaniu kodu, komentarzy i uwag review w tym repozytorium.

## Kontekst projektu

1. To rozszerzenie Chrome Manifest V3 dla Google Meet.
2. Kod źródłowy to TypeScript w `src/`.
3. webpack buduje entrypointy JavaScript i kopiuje `manifest.json` oraz pliki HTML do `dist/`.
4. Projekt nie ma backendu, bazy danych ani celu wdrożenia.

## Priorytety review

1. Regresje funkcjonalne w zbieraniu transkrypcji, przechwytywaniu karty, nagrywaniu offscreen, pobieraniu plików i przepływie uprawnień mikrofonu.
2. Ryzyka bezpieczeństwa i prywatności, szczególnie niepotrzebne uprawnienia Chrome albo dane opuszczające przeglądarkę.
3. Brak walidacji dla zmienionego zachowania.
4. Niespójność z istniejącą prostą strukturą TypeScript/webpack.
5. Niepotrzebna złożoność albo szerokie refaktory.

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
