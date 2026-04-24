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
5. Otworz Google Meet i wlacz captions.
6. Kliknij ikone rozszerzenia i sprawdz `Download Transcript`.
7. Jesli zmiana dotyczy nagrywania, kliknij `Enable Microphone` w razie potrzeby, uruchom `Start Recording`, zatrzymaj nagranie i potwierdz pobranie pliku `.webm`.
8. Sprawdz konsole service workera, offscreen document i karty Meet pod katem nowych bledow.

## Kryteria zaliczenia

- `make check` konczy sie sukcesem.
- `dist/` laduje sie jako rozszerzenie bez bledow manifestu.
- Transkrypt zapisuje plik `.txt`, gdy captions sa wlaczone.
- Nagrywanie startuje, zatrzymuje sie i pobiera `.webm`, jesli dotknieto kodu recording/offscreen/permissions.
