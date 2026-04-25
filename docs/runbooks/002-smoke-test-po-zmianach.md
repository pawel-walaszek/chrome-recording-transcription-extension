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
9. Uruchom `Start Recording`, zatrzymaj nagranie i potwierdz pobranie pliku `.webm`.
10. Sprawdz konsole service workera, offscreen document i karty testowej pod katem nowych bledow.

## Kryteria zaliczenia

- `make check` konczy sie sukcesem.
- `dist/` laduje sie jako rozszerzenie bez bledow manifestu.
- Strona konfiguracji mikrofonu pokazuje `Default microphone` i pozwala zapisac wybor.
- Nagrywanie startuje, zatrzymuje sie i pobiera `.webm`, jesli dotknieto kodu recording/offscreen/permissions.
