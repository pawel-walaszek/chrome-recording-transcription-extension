# Runbook: smoke test po zmianach

## Cel

Szybko potwierdzic, ze build oraz najwazniejsze sciezki rozszerzenia dzialaja po zmianie.

## Wymagania

- Docker z obsluga `docker compose` v2.
- `make`.
- Google Chrome lub Chromium z obsluga Manifest V3 i Offscreen API.
- Testowe spotkanie Google Meet albo mozliwosc otwarcia strony `https://meet.google.com/*`.

## Kroki

1. Uruchom `make check`.
2. Otworz `chrome://extensions`.
3. Wlacz Developer mode.
4. Kliknij Reload przy rozszerzeniu, jesli bylo juz zaladowane, albo Load unpacked i wybierz `dist/`.
5. Otworz Google Meet albo inna karte testowa z odtwarzanym audio/wideo.
6. Kliknij `Enable Microphone` albo `Microphone Settings`.
7. Na stronie konfiguracji wybierz `Default microphone`, zapisz wybór i wroc do testowanej karty.
8. Jesli dostepne sa co najmniej dwa mikrofony, wybierz konkretny mikrofon, zapisz wybor i potwierdz, ze popup pokazuje zapisany mikrofon.
9. Jesli popup pokazuje `Not connected`, kliknij `Connect to Meet2Note`, przejdz przez backend i potwierdz, ze callback zapisuje polaczenie.
10. Uruchom `Start Recording`, zatrzymaj nagranie przez `Stop & Upload` i potwierdz upload do `https://meet2note.com`.
11. Potwierdz, ze Chrome nie pobiera lokalnego pliku `.webm`.
12. Jesli dotknieto kolejki uploadu, potwierdz, ze popup pokazuje sekcje `Recent recordings` nawet przed pierwszym lokalnym nagraniem, a potem rozpocznij drugie nagranie zanim pierwszy upload sie zakonczy i potwierdz, ze popup pokazuje obie pozycje historii.
13. Jesli testujesz retry, czasowo odetnij backend albo siec, zatrzymaj nagranie i potwierdz, ze popup pokazuje ponawianie uploadu konkretnej pozycji co okolo 15 sekund.
14. Jesli testujesz autoryzacje, usun albo uszkodz token w `chrome.storage.local` i potwierdz, ze popup wymaga ponownego polaczenia zamiast bez konca ponawiac upload.
15. Przywroc backend albo siec i potwierdz, ze kolejna proba uploadu konczy sie sukcesem.
16. Jesli dotknieto lokalnego spoolu nagran, po zatrzymaniu nagrania przeladuj rozszerzenie albo service worker i potwierdz, ze pozycja nadal jest widoczna oraz upload wznawia sie ze spoolu.
17. Sprawdz konsole service workera, offscreen document i karty testowej pod katem nowych bledow.

## Kryteria zaliczenia

- `make check` konczy sie sukcesem.
- `dist/` laduje sie jako rozszerzenie bez bledow manifestu.
- Popup i strona konfiguracji mikrofonu renderuja UI Ant Design bez pustego ekranu.
- Callback `connect-callback.html` jest w `dist/` i zapisuje polaczenie Meet2Note po poprawnym `code`/`state`.
- Strona konfiguracji mikrofonu pokazuje `Default microphone` i pozwala zapisac wybor.
- Nagrywanie startuje, zatrzymuje sie i wysyla assety do backendu, jesli dotknieto kodu recording/offscreen/upload/permissions.
- Po sukcesie Chrome nie pobiera lokalnego `.webm`.
- Upload jednego nagrania nie blokuje rozpoczecia kolejnego nagrania.
- Zakonczone nagranie pozostaje w lokalnym spoolu po restarcie service workera/offscreen do czasu udanego uploadu.
- Na aktywnym spotkaniu Meet znacznik rozszerzenia pokazuje `RDY`, po starcie `REC`, a wyjscie ze spotkania zatrzymuje nagrywanie i uruchamia upload.
- Przy bledzie uploadu popup pokazuje retry dla konkretnej pozycji, a kolejna proba nastepuje co okolo 15 sekund.
- Przy bledzie autoryzacji `401`/`403` popup pokazuje koniecznosc ponownego polaczenia z Meet2Note.
