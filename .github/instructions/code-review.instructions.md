# Instrukcje code review

Priorytetyzuj uwagi w tej kolejności:

1. Regresje zachowania w zbieraniu napisów Google Meet, kontrolkach popupu, komunikacji background/offscreen, nagrywaniu i pobieraniu plików.
2. Ryzyka związane z uprawnieniami Chrome, prywatnością albo obsługą danych.
3. Błędy builda albo pakowania.
4. Brak testu albo smoke testu dla zmienionego zachowania.
5. Problemy utrzymywalności, które utrudniają przyszłe zmiany.

Nie blokuj na uwagach wyłącznie formatowych, chyba że problem stylu utrudnia zrozumienie kodu.

Zgłoś wszystkie możliwe do wdrożenia uwagi, które potrafisz zidentyfikować w bieżącej rundzie review. Nie cedź celowo komentarzy przez wiele rund. Kolejne rundy powinny skupiać się na nowo wprowadzonych zmianach, nierozwiązanych uwagach albo problemach, które wcześniej nie były rozsądnie widoczne.

Przy każdej możliwej do wdrożenia uwadze podaj:

1. plik albo zachowanie, którego dotyczy,
2. dlaczego ma znaczenie,
3. praktyczną poprawkę albo krok weryfikacji.
